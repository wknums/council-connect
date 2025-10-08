from azure.cosmos import CosmosClient, PartitionKey
import os
import dotenv

dotenv.load_dotenv()

# Environment variables
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
DATABASE_NAME = os.getenv("COSMOS_DB_NAME")
CONTAINER_NAME = os.getenv("COSMOS_ONE_CONTAINER_NAME")

# Initialize Cosmos client
client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)

# Create database if not exists
database = client.create_database_if_not_exists(id=DATABASE_NAME)

# Create single container with partition key councillorId
container = database.create_container_if_not_exists(
    id=CONTAINER_NAME,
    partition_key=PartitionKey(path="/councillorId"),
    offer_throughput=400
)

# Optional: Define indexing policy for performance
indexing_policy = {
    "indexingMode": "consistent",
    "automatic": True,
    "includedPaths": [
        {"path": "/*"}  # Index all properties
    ],
    "excludedPaths": [
        {"path": "/recipients/*"}  # Exclude large arrays to save RU
    ]
}

container.replace_throughput(400)
print(f"Container '{CONTAINER_NAME}' created with partition key '/councillorId'")
