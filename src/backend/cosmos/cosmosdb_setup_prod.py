from azure.cosmos import CosmosClient, PartitionKey
import os

# Environment variables
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
DATABASE_NAME = "CouncillorEmailDB"

# Initialize Cosmos client
client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)

# Create database if not exists
database = client.create_database_if_not_exists(id=DATABASE_NAME)

councilor_profile = {
  "id": "councillor123",
  "councillorId": "councillor123",
  "name": "John Doe",
  "email": "john.doe@city.gov"
}

distribution_list = {
  "id": "list001",
  "councillorId": "councillor123",
  "name": "Ward 5 Residents",
  "recipients": ["citizen1@mail.com", "citizen2@mail.com"]
}

opt_out={
  "id": "optout001",
  "councillorId": "councillor123",
  "email": "citizen1@mail.com",
  "timestamp": "2025-10-07T12:00:00Z"
}

sent_email = {
  "id": "email001",
  "councillorId": "councillor123",
  "subject": "Community Update",
  "body": "Hello Ward 5...",
  "timestamp": "2025-10-07T12:00:00Z"
}
engagement_analytics = {
  "id": "engage001",
  "councillorId": "councillor123",
  "emailId": "email001",
  "recipient": "citizen1@mail.com",
  "opened": true,
  "clicked": false,
  "timestamp": "2025-10-07T12:05:00Z"
}


# Containers configuration
containers = [
    {
        "id": "Councillors",
        "partition_key": PartitionKey(path="/councillorId"),
        "throughput": 400
    },
    {
        "id": "DistributionLists",
        "partition_key": PartitionKey(path="/councillorId"),
        "throughput": 400
    },
    {
        "id": "OptOutLists",
        "partition_key": PartitionKey(path="/councillorId"),
        "throughput": 400
    },
    {
        "id": "SentEmails",
        "partition_key": PartitionKey(path="/councillorId"),
        "throughput": 400
    },
    {
        "id": "EngagementAnalytics",
        "partition_key": PartitionKey(path="/councillorId"),
        "throughput": 400
    }
]

# Create containers
for container in containers:
    database.create_container_if_not_exists(
        id=container["id"],
        partition_key=container["partition_key"],
        offer_throughput=container["throughput"]
    )

print("Cosmos DB setup complete!")