import os
import time
import subprocess
import shutil
import json
import socket
import pytest

FUNCTIONS_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'backend')
HOST = '127.0.0.1'
PORT = 7071
BASE = f'http://{HOST}:{PORT}/api'


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        try:
            s.connect((HOST, port))
            return True
        except OSError:
            return False

@pytest.fixture(scope='session')
def functions_host():
    if not shutil.which('func'):
        pytest.skip('Azure Functions Core Tools (func) not installed')
    env = os.environ.copy()
    env.setdefault('APP_ENV', 'dev')
    # Start host only if not already running
    proc = None
    if not _port_open(PORT):
        proc = subprocess.Popen(['func', 'start', '--verbose'], cwd=FUNCTIONS_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        # Wait for ready signal or timeout
        start = time.time()
        ready = False
        while time.time() - start < 30:
            if _port_open(PORT):
                ready = True
                break
            time.sleep(1)
        if not ready:
            proc.terminate()
            pytest.skip('Functions host failed to start in time')
    yield
    if proc:
        proc.terminate()

@pytest.mark.live
def test_live_openapi(functions_host):
    import requests  # imported here to avoid dependency if test skipped
    r = requests.get(f'{BASE}/openapi.json')
    assert r.status_code == 200
    data = r.json()
    assert data['info']['title'] == 'CouncilConnect API'
