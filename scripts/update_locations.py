import json
import psycopg2

from config import DB_CONFIG, JSON_FILE

QUERY = """
SELECT
    ("UPDATEDDATA"::json->>'Latitude')::numeric AS "Latitude",
    ("UPDATEDDATA"::json->>'Longitude')::numeric AS "Longitude"
FROM "MachineDataUpdate"
WHERE
    ("UPDATEDDATA"::json->>'Latitude') ~ '^-?[0-9]+(\\.[0-9]+)?$'
    AND ("UPDATEDDATA"::json->>'Longitude') ~ '^-?[0-9]+(\\.[0-9]+)?$'
LIMIT 3000;
"""


def fetch_locations():
    conn = psycopg2.connect(**DB_CONFIG)

    try:
        with conn.cursor() as cur:
            cur.execute(QUERY)

            columns = [desc[0] for desc in cur.description]

            locations = []

            for row in cur.fetchall():
                locations.append({
                    "Latitude": float(row[0]),
                    "Longitude": float(row[1])
                })

            return locations

    finally:
        conn.close()


def update_json(locations):
    with open(JSON_FILE, "w", encoding="utf-8") as file:
        json.dump(locations, file, indent=4)


def main():
    print("Fetching locations from PostgreSQL...")

    locations = fetch_locations()

    print(f"Fetched {len(locations):,} locations.")

    print("Updating Angular JSON...")

    update_json(locations)

    print("Done.")


if __name__ == "__main__":
    main()