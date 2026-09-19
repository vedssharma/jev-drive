# Jev Drive

Completed follow-up work: [TODO checklist](driving_sim/TODO.md).

A local browser-based 3D driving sandbox. Jev makes real speed, lane and route decisions;
Three.js renders a connected city grid and the browser simulates the physics.

## Launch

Requires Python 3.11+, Node.js/npm, and [uv](https://docs.astral.sh/uv/).

From the repository root:

```sh
cp .env.example .env
# Edit .env and add your TypeSafe API key.
npm --prefix driving_sim ci
uv sync
uv run uvicorn driving_sim.app:app --host 127.0.0.1 --port 8768
```

Open <http://127.0.0.1:8768>. Click **Start driving**. The repository-root `.env`
is read by the server; set `TYPESAFE_API_KEY` there if missing. `TYPESAFE_AI_API_KEY`
is also accepted. `DRIVING_MODEL` optionally overrides the default `jev-latest`.
Credentials never enter the browser. Driving uses your TypeSafe account and incurs
API usage; input tokens and request latency are visible. Pausing or hiding the tab
stops new requests. Fonts use Google Fonts with system fallbacks; Three.js is served locally.

## Controls

- **Space:** start / pause; **C:** orbit, overhead map, driver camera; **R:** reset.
- Clear, rain, fog, snow; day/night; adjustable background traffic density.
- Let Jev explore, or request a left turn, right turn or straight route at the next available junction.
- Follow the street name, planned turn, mini-map trail and completed-turn/pass counters.
- Inject a slow car, pedestrian, blocked lane, ambulance, or 16-second red signal.
- Optional emergency brake assist, with separate intervention counts.
- Inspect actual observations, Jev answers, distributions, model version and usage.
- Collision detection pauses the run; reset starts a new deterministic world.

## Control loop

`simulation.js` produces a structured observation with speed, lane, friction,
visibility, stopping distance, signal phase, nearby road users and lane gaps.
Four parallel Choice questions select a pace (0/10/22/35/50 km/h or a continuous signal approach), lane
action (hold/left/right), route (straight/left/right/keep), and the primary attention category. Attention is a
separate classification, not a generated explanation of the driving decision.

The server reuses an async TypeSafe client; the browser permits one request at a
time and waits 550 ms after an answer. The physics engine translates Jev's choices
into acceleration and lateral movement; steering requires forward motion. It
checks current gaps and closing speeds over the expected maneuver duration before accepting a lane change. This lane check is always
active; the optional brake assist only controls longitudinal emergency protection.

For signals, Jev can select **Approach**, a continuous motion primitive that keeps
rolling toward the stop line and reduces target speed along a grip-adjusted braking
curve. Ordinary braking uses 2.5 × grip m/s²; the curve includes a 0.8s reaction
allowance and a 1.5m stop-line buffer. At 50 km/h on dry pavement it permits full
cruising until approximately 51m from the line, then slows progressively. Jev sees
the calculated approach phase and speed and chooses when to use it. Immediate stop
and emergency braking remain separate. These are simulation tuning parameters,
not validated human-driver or real-vehicle specifications.

Jev failures pause the simulation visibly; there is no scripted substitute for
Jev driving. Decisions more than two simulated seconds old are discarded. An
age of 2.5 simulated seconds without an applied decision triggers braking.
Weather changes, injected hazards, route changes, junction transitions, reset and pause invalidate in-flight responses.

Rain and snow reduce acceleration and grip and increase braking distance. Fog and
night reduce road-user visibility. Signals are known map information, including
when they are beyond visibility. Background cars use scripted following/signal
rules; cross traffic and scheduled pedestrians enter during the red phase.

## Scope

This is an exploratory simulation, not a validated autonomous-driving system.
It has a connected street grid with two lanes per direction, curved intersection
turns and overtaking. It does not have destinations, sensor-image perception,
detailed tire dynamics or a full urban traffic model. Buildings are
visual and do not occlude model observations. Background actors are scripted;
their interactions are simplified. The observation and physics are browser-owned.
The model can make mistakes, and the brake assist is not a guarantee of avoiding
collisions. Disable it to inspect unassisted model braking decisions.

The backend is deliberately local-only with host/origin checks, observation size
limits and strict schema validation. It has no multi-user authentication and
should not be exposed publicly as-is.

## Validation

```sh
npm --prefix driving_sim test
uv run pytest -q driving_sim/tests/test_api.py
uv run ruff check driving_sim
node --check driving_sim/static/app.js
node --check driving_sim/static/renderer.js
```

Tests exercise turn continuity from all four headings, persistent world-space traffic,
blocked turn exits, perpendicular signal coordination, rear closing speeds,
passing clearance, deferred route requests, stale decisions, friction, red-signal protection, lane clearance,
stationary steering, visibility, collision detection, signal transitions, missing
credentials, request boundaries, typed answer mapping, and sanitized API errors.

Live checks against `jev-1.13.0` on September 19, 2026 returned cruise for a clear
road, stop for a red light 16m away, stop for a pedestrian 12m away, slow for snow
with reduced visibility, and left for a barrier with a clear adjacent lane.
These are smoke checks, not an accuracy benchmark. Browser checks verified a live
drive, pedestrian response, rain/night controls and actual response telemetry.

## Routes and passing

Jev chooses a route before each junction using the requested direction or a
preference based on outgoing traffic and previously visited routes. The selected
route stays committed through the junction. The car prepares the correct lane,
slows to a grip-adjusted turn speed, checks the arc for traffic and pedestrians,
and follows a continuous quarter-circle into the new street. A turn is skipped
if the required lane cannot be reached safely. Late requests carry over to the
next available junction. Traffic keeps its world position across ego turns.

Jev receives an overtaking opportunity when a slower lead vehicle impedes travel,
excluding red-light queues and imminent turns. Passing uses the left lane, holds
it until the overtaken vehicle is at least 24m behind, and returns right when
there is sufficient clearance. Lane changes are prohibited inside junctions and
checked against predicted front/rear gaps with weather-dependent steering time.
Turn conflict checks and lane clearance remain active independently of the
optional longitudinal brake assist.

Follow-up live checks on September 19, 2026 verified a Jev-selected pass and return
right followed by a left turn without collisions in a controlled slow-car run,
and a right turn in the browser with normal traffic. These are smoke tests,
not a guarantee of safe behavior in every traffic configuration.

Turn smoothing: observations during a maneuver now measure hazards along the
remaining arc and 15m of its exit, using vehicle footprints to exclude adjacent
lanes. Clear left turns are capped at 22 km/h on dry pavement; tighter right
turns use approximately 17 km/h, with lower limits as grip falls. Recent Jev
pace decisions remain valid through the exit, while the normal freshness
watchdog and genuine path-conflict braking remain active. Regression tests cover
off-path pedestrians, adjacent-lane vehicles, real obstacles, signal changes
after entry, and continuous motion through the exit.
