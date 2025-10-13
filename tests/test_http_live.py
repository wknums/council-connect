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
    env = os.environ.copy()
    env.setdefault('APP_ENV', 'dev')

    # If a host is already running (e.g. launched via scripts), reuse it and do not require Core Tools.
    if _port_open(PORT):
        yield
        return

    if not shutil.which('func'):
        pytest.skip('Azure Functions Core Tools (func) not installed and no host detected on port 7071')

    proc = subprocess.Popen(
        ['func', 'start', '--verbose'],
        cwd=FUNCTIONS_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    start = time.time()
    ready = False
    try:
        while time.time() - start < 45:
            if _port_open(PORT):
                ready = True
                break
            if proc.poll() is not None:
                break
            time.sleep(1)
        if not ready:
            proc.terminate()
            pytest.skip('Functions host failed to start in time')
        yield
    finally:
        if proc and proc.poll() is None:
            proc.terminate()

@pytest.mark.live
def test_live_openapi(functions_host):
    import requests  # imported here to avoid dependency if test skipped
    r = requests.get(f'{BASE}/openapi.json')
    assert r.status_code == 200
    data = r.json()
    assert data['info']['title'] == 'CouncilConnect API'
