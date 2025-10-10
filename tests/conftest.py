import os
import sys
import uuid
import pathlib
import pytest
from azure.cosmos import CosmosClient, exceptions

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def cosmos_env():
    """Ensure required environment vars for dev mode are present.
    Falls back to emulator-style defaults if not provided.
    """
    os.environ.setdefault('APP_ENV', 'dev')
    os.environ.setdefault('COSMOS_ENDPOINT', 'https://localhost:8081')
    os.environ.setdefault('COSMOS_KEY', 'C2FBB==FAKEKEY')
    os.environ.setdefault('COSMOS_DB_NAME', 'TestDb')
    os.environ.setdefault('COSMOS_ONE_CONTAINER_NAME', 'OneContainer')
    return {
        'endpoint': os.environ['COSMOS_ENDPOINT'],
        'key': os.environ['COSMOS_KEY'],
        'db': os.environ['COSMOS_DB_NAME'],
        'container': os.environ['COSMOS_ONE_CONTAINER_NAME'],
    }


@pytest.fixture(scope="session")
def cosmos_container(cosmos_env):
    """Get/create the single dev container, or skip tests if unreachable."""
    try:
        client = CosmosClient(cosmos_env['endpoint'], cosmos_env['key'])
        db = client.create_database_if_not_exists(id=cosmos_env['db'])
        container = db.create_container_if_not_exists(
            id=cosmos_env['container'],
            partition_key={'paths': ['/councillorId'], 'kind': 'Hash'}
        )
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"Cosmos DB not reachable: {e}")
    return container


@pytest.fixture()
def councillor_id():
    return f"test-cid-{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def cleanup_after_test(cosmos_container, councillor_id):
    # Run test
    yield
    # Cleanup items for this councillorId
    try:
        query = "SELECT c.id FROM c WHERE c.councillorId=@cid"
        items = list(cosmos_container.query_items(
            query=query,
            parameters=[{'name': '@cid', 'value': councillor_id}],
            enable_cross_partition_query=True
        ))
        for it in items:
            try:
                cosmos_container.delete_item(it['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
    except Exception:
        # Swallow cleanup errors; test artifacts won't block suite.
        pass

