"""Install browser dependencies and publish them through Vercel's static CDN."""

import shutil
import subprocess
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    subprocess.run(["npm", "--prefix", "driving_sim", "ci"], cwd=root, check=True)
    shutil.copytree(root / "driving_sim/node_modules/three/build", root / "public/vendor",
                    dirs_exist_ok=True)


if __name__ == "__main__":
    main()
