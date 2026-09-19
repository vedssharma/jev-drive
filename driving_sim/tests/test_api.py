from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from driving_sim.app import app


def observation():
    return {
        "sequence": 1,
        "state": {
            "ego": {"speed_kmh": 0., "lane": 1, "changing_lane": False, "stopping_distance_m": 0.},
            "environment": {"weather": "clear", "time_of_day": "day", "visibility_m": 220.,
                            "grip": 1., "speed_limit_kmh": 50.},
            "signal": {"color": "green", "stop_line_distance_m": 80., "changes_in_s": 19.,
                       "in_intersection": False, "approach_phase": "clear",
                       "approach_speed_kmh": 50., "comfortable_stopping_distance_m": 1.5},
            "road_users": [],
            "lanes": [{"lane": i, "gap_ahead_m": 300., "gap_behind_m": 300.,
                       "safe_to_enter": True, "lead_speed_kmh": 50., "rear_speed_kmh": 0.} for i in range(2)],
            "navigation": {"current_street": "Linden Avenue", "heading": "Northbound",
                           "planned_direction": "undecided", "requested_direction": "auto",
                           "preferred_direction": "right", "required_lane": -1,
                           "turning": False, "turn_clear": True,
                           "options": [{"direction": d, "street": "Market Street",
                                        "vehicles_ahead": 0, "visits": 0}
                                       for d in ["left", "right", "straight"]]},
            "overtaking": {"active": False, "passed_clear": False, "lead_gap_m": 220.,
                           "lead_speed_kmh": 50., "beneficial": False,
                           "right_lane_clear": True, "lane_change_allowed": True},
        },
    }


def test_missing_key_and_boundaries(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_AI_API_KEY", raising=False)
    with TestClient(app) as c:
        assert not c.get("/api/status").json()["configured"]
        assert c.post("/api/decide", json=observation()).status_code == 503
        assert c.post("/api/decide", json=observation(),
                      headers={"Origin": "https://elsewhere.test"}).status_code == 403
        assert c.post("/api/decide", content="x" * 24001).status_code == 413
        body = observation()
        body["state"]["ego"]["speed_kmh"] = -10
        assert c.post("/api/decide", json=body).status_code == 422
        assert c.get("/.env").status_code == 404


def test_choices_and_failures(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_AI_API_KEY", raising=False)
    with TestClient(app) as c:
        fake = SimpleNamespace(system_one=AsyncMock(), aclose=AsyncMock())
        fake.system_one.return_value = SimpleNamespace(
            choices={key: SimpleNamespace(choice=value, confidence=.9, probabilities={value: 1.})
                     for key, value in {"pace": "cruise", "lane": "hold", "attention": "open_road", "route": "right"}.items()},
            model="test-model", usage=SimpleNamespace(input_tokens=100),
        )
        app.state.client = fake
        result = c.post("/api/decide", json=observation())
        assert result.status_code == 200
        assert result.json()["answers"]["pace"]["choice"] == "cruise"
        assert result.json()["sequence"] == 1
        assert result.json()["answers"]["route"]["choice"] == "right"
        assert len(fake.system_one.call_args.kwargs["questions"]) == 4
        fake.system_one.side_effect = RuntimeError("secret should never reach client")
        result = c.post("/api/decide", json=observation())
        assert result.status_code == 502
        assert "secret" not in result.text


def test_deployment_hosts(monkeypatch):
    from fastapi import FastAPI
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    from driving_sim.app import allowed_hosts

    monkeypatch.setenv("VERCEL_URL", "jev-drive-build.vercel.app")
    monkeypatch.setenv("VERCEL_BRANCH_URL", "jev-drive-git-main.vercel.app")
    monkeypatch.setenv("VERCEL_PROJECT_PRODUCTION_URL", "jev-drive.vercel.app")
    monkeypatch.setenv("ALLOWED_HOSTS", " drive.example.com, team-alias.vercel.app ")
    deployed = FastAPI()
    deployed.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts())

    @deployed.get("/")
    def home():
        return {"ok": True}

    with TestClient(deployed) as c:
        for host in ["localhost", "jev-drive.vercel.app", "jev-drive-build.vercel.app",
                     "jev-drive-git-main.vercel.app", "drive.example.com", "team-alias.vercel.app"]:
            assert c.get("/", headers={"Host": host}).status_code == 200
        for host in ["unrelated.vercel.app", "attacker.example", "jev-drive.vercel.app.attacker.example"]:
            assert c.get("/", headers={"Host": host}).status_code == 400
