import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
QUEUE_NAME = os.getenv("QUEUE_NAME", "queue:ab1")
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", str(BASE_DIR / "runtime" / "tmp")))
RESULT_TTL_SECONDS = int(os.getenv("RESULT_TTL_SECONDS", "1800"))

JOB_TIMEOUT_SECONDS = int(os.getenv("JOB_TIMEOUT_SECONDS", "900"))
MSA_COMMAND_TIMEOUT_SECONDS = int(os.getenv("MSA_COMMAND_TIMEOUT_SECONDS", "180"))
TREE_COMMAND_TIMEOUT_SECONDS = int(os.getenv("TREE_COMMAND_TIMEOUT_SECONDS", "900"))
STALE_RUNNING_SECONDS = int(os.getenv("STALE_RUNNING_SECONDS", str(JOB_TIMEOUT_SECONDS + 120)))

IS_WINDOWS = os.name == "nt"
BIN_SUBDIR = "windows" if IS_WINDOWS else "linux"
BIN_DIR = BASE_DIR / "bin" / BIN_SUBDIR

MUSCLE_BIN = os.getenv(
    "MUSCLE_BIN",
    str(BIN_DIR / ("muscle.exe" if IS_WINDOWS else "muscle"))
)

CLUSTALW_BIN = os.getenv(
    "CLUSTALW_BIN",
    str(BIN_DIR / ("clustalw2.exe" if IS_WINDOWS else "clustalw"))
)

IQTREE_BIN = os.getenv(
    "IQTREE_BIN",
    str(BIN_DIR / ("iqtree2.exe" if IS_WINDOWS else "iqtree3"))
)

FRONTEND_DIR = BASE_DIR / "frontend"
LOG_DIR = BASE_DIR / "runtime" / "logs"
TMP_DIR = BASE_DIR / "runtime" / "tmp"