import os
import logging
from typing import Optional, Dict, Any, List
import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# --- ロギング設定 ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

# --- 環境変数の読み込み ---
load_dotenv()
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY")
TOMTOM_BASE_URL = os.getenv("TOMTOM_BASE_URL", "https://api.tomtom.com")
FASTAPI_PORT = int(os.getenv("FASTAPI_PORT", 8002))

if not TOMTOM_API_KEY:
    raise ValueError("TOMTOM_API_KEY is not set.")

# --- HTTPX クライアント ---
client: Optional[httpx.AsyncClient] = None

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = httpx.AsyncClient(base_url=TOMTOM_BASE_URL)
    logger.info(f"HTTPX Client started for {TOMTOM_BASE_URL}")
    yield
    if client:
        await client.aclose()
        logger.info("HTTPX Client closed.")

app = FastAPI(lifespan=lifespan)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- TomTom API Helper ---
async def fetch_tomtom(path: str, params: Optional[Dict[str, Any]] = None):
    if client is None:
        raise HTTPException(status_code=500, detail="Client not initialized")

    p = params.copy() if params else {}
    p["key"] = TOMTOM_API_KEY

    try:
        response = await client.get(path, params=p)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"TomTom Error: {e.response.status_code} - {e.response.text}")
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        logger.error(f"Request Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

import asyncio
import math

def generate_rect_grid(min_lat, min_lon, max_lat, max_lon, step_km=10):
    """
    Generate a grid of coordinates covering the rectangular area.
    """
    results = []

    # Approx conversions
    # 1 deg lat ~ 111km
    deg_per_km_lat = 1 / 111.0

    # Use average latitude for longitude conversion
    avg_lat = (min_lat + max_lat) / 2
    deg_per_km_lon = 1 / (111.0 * math.cos(math.radians(avg_lat)))

    step_lat = step_km * deg_per_km_lat
    step_lon = step_km * deg_per_km_lon

    # Adjust step to be slightly smaller to ensure overlap/coverage (e.g. 0.8 * step) if using radius search at points
    # If we use strict simple grid, we can stick to step_km.
    # Let's generate points that will be centers of radius searches.

    curr_lat = min_lat + (step_lat / 2)
    while curr_lat < max_lat + step_lat:
        curr_lon = min_lon + (step_lon / 2)
        while curr_lon < max_lon + step_lon:
            # Clamp to bounds if needed, but for coverage we just need points
            if curr_lat >= min_lat and curr_lat <= max_lat + step_lat and curr_lon >= min_lon and curr_lon <= max_lon + step_lon:
                results.append((curr_lat, curr_lon))
            elif (curr_lat - (step_lat/2) < max_lat) and (curr_lon - (step_lon/2) < max_lon):
                # Edge case handling to include borders
                results.append((curr_lat, curr_lon))

            curr_lon += step_lon
        curr_lat += step_lat

    return results

@app.get("/api/ev-stations")
async def get_ev_stations(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float
):
    """
    Search for EV stations within a bounding box using Asynchronous Batch Search API.
    """
    # Calculate dimensions
    lat_diff = abs(max_lat - min_lat)
    lon_diff = abs(max_lon - min_lon)

    if lat_diff > 5.0 or lon_diff > 5.0:
        logger.warning("Requested area is very large.")

    # Configuration for Grid Search
    max_diff = max(lat_diff, lon_diff)
    if max_diff < 0.1: step_km, sub_radius_mt = 3, 5000
    elif max_diff < 0.5: step_km, sub_radius_mt = 10, 15000
    elif max_diff < 2.0: step_km, sub_radius_mt = 25, 35000
    else:
        step_km = max(30, (max_diff * 111) / 8)
        sub_radius_mt = 50000


    search_points = generate_rect_grid(min_lat, min_lon, max_lat, max_lon, step_km=step_km)

    if not search_points:
        return {"results": []}

    logger.info(f"Generated {len(search_points)} search points (step={step_km:.1f}km) for bounds ({min_lat},{min_lon})-({max_lat},{max_lon})")

    # Construct Batch Items
    batch_items = []

    import urllib.parse
    # URL encode the category part of the path because it goes into a JSON body
    # and won't be auto-encoded by the HTTP client
    encoded_category = urllib.parse.quote("electric vehicle station")
    # Batch API item query paths omit the service version (e.g. /search/2)
    base_query_path = f"/categorySearch/{encoded_category}.json"

    for p_lat, p_lon in search_points:
        # Construct the query string for each item
        # Note: Do not include API Key in individual items for Batch API, only in the batch request itself.
        params = {
            "lat": p_lat,
            "lon": p_lon,
            "radius": sub_radius_mt,
            "limit": 100,
            "categorySet": "7309",
            "relatedPois": "off",
            "language": "NGT"
        }
        # Encode params and append to path
        query_string = urllib.parse.urlencode(params)
        item = {"query": f"{base_query_path}?{query_string}"}
        batch_items.append(item)

    # 1. Submit Batch Request
    batch_url = "/search/2/batch.json"
    batch_payload = {"batchItems": batch_items}

    # We need to use client.post here. Since fetch_tomtom is designed for GET and has specific error handling,
    # let's implement the batch flow directly here or add a helper for POST.
    # For simplicity, using client directly here but with similar error handling context.

    if client is None:
        raise HTTPException(status_code=500, detail="Client not initialized")

    try:
        # Submit batch
        submit_response = await client.post(
            batch_url,
            json=batch_payload,
            params={"key": TOMTOM_API_KEY},
            timeout=30.0
        )

        # TomTom returns 303 See Other or 202 Accepted for asynchronous batch
        if submit_response.status_code not in [200, 202, 303]:
            submit_response.raise_for_status()

        # 2. Get Status URL from Location Header
        location_url = submit_response.headers.get("Location")
        if not location_url:
            # Fallback: sometimes it might be in the body or standard construction?
            # As per docs, it should be in Location header.
            logger.error("No Location header in batch submission response")
            raise HTTPException(status_code=500, detail="Batch submission failed: No status URL")

        # The Location URL is usually a full URL. httpx logic:
        # If we use client.get(url), and url is absolute, it ignores base_url. This is what we want.

        # 3. Poll for Completion
        logger.info(f"Batch submitted. Polling location: {location_url}")

        # We need to respect the Retry-After header if present, but for now simple polling.
        start_time = asyncio.get_event_loop().time()
        max_wait_time = 120 # Increased from 60 to 120 seconds

        while True:
            if asyncio.get_event_loop().time() - start_time > max_wait_time:
                raise HTTPException(status_code=504, detail="Batch processing timed out")

            # Check status
            try:
                status_response = await client.get(location_url, timeout=10.0)
            except httpx.ReadTimeout:
                logger.warning("Timeout while polling batch status. Retrying...")
                await asyncio.sleep(1.0)
                continue

            if status_response.status_code == 200:
                # Completed
                batch_results = status_response.json()
                break
            elif status_response.status_code == 202:
                # Still processing
                await asyncio.sleep(2.0) # Increased polling interval for efficiency
                continue
            else:
                # Error
                status_response.raise_for_status()

    except httpx.HTTPStatusError as e:
        logger.error(f"TomTom Batch Error: {e.response.status_code} - {e.response.text}")
        raise HTTPException(status_code=e.response.status_code, detail=f"TomTom API Error: {e.response.text}")
    except Exception as e:
        import traceback
        logger.error(f"Batch Request Error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

    # 4. Process Results
    stations_map = {}
    if "batchItems" in batch_results:
        for i, item in enumerate(batch_results["batchItems"]):
            if item.get("statusCode") == 200 and "response" in item:
                results = item["response"].get("results", [])
                for station in results:
                    if "id" in station:
                        stations_map[station["id"]] = station
            else:
                logger.error(f"Batch item {i} failed: {item.get('statusCode')} - {item.get('response')}")

    unique_stations = list(stations_map.values())
    logger.info(f"Total unique stations found via Batch API: {len(unique_stations)}")

    return {"results": unique_stations}

@app.get("/api/ev-stations/availability/{availability_id}")
async def get_availability(availability_id: str):
    """
    Get real-time availability for a specific station.
    """
    path = f"/search/2/chargingAvailability.json" # This might be different based on the documentation linked
    # Actually checking the URL provided by user:
    # https://api.tomtom.com/evcharging/availability/2/{chargingAvailability}.{ext}?key={Your_API_Key}
    path = f"/search/2/chargingAvailability/{availability_id}.json"
    return await fetch_tomtom(path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=FASTAPI_PORT, reload=True)
