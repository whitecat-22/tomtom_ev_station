import React, { useEffect, useRef, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';

interface EVStation {
  id: string;
  poi: {
    name: string;
  };
  address: {
    freeformAddress: string;
  };
  position: {
    lat: number;
    lon: number;
  };
}

const INITIAL_VIEW_STATE = {
  longitude: 139.7671,
  latitude: 35.6812,
  zoom: 11,
  pitch: 0,
  bearing: 0
};

const MapComponent = () => {
  const [stations, setStations] = useState<EVStation[]>([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedStation, setSelectedStation] = useState<EVStation | null>(null);

  useEffect(() => {
    // Basic connectivity check
    console.log("MapComponent Mounted");
    fetchStations();
  }, []);

  // Helper to calculate bounds from viewState (approximate for initial load/fallback)
  // Or better, use mapRef.current.getBounds() if available.
  const getBoundsFromMap = () => {
      if (mapRef.current) {
          const bounds = mapRef.current.getBounds();
          return {
              minLon: bounds.getWest(),
              minLat: bounds.getSouth(),
              maxLon: bounds.getEast(),
              maxLat: bounds.getNorth()
          };
      }
      // Fallback relative to viewState (roughly 0.1 deg ~ 11km)
      // At zoom 11, maybe cover 0.5 deg?
      const delta = 0.3; // Approx 30km half-width
      return {
          minLon: viewState.longitude - delta,
          minLat: viewState.latitude - delta,
          maxLon: viewState.longitude + delta,
          maxLat: viewState.latitude + delta
      };
  };

  const fetchStations = async () => {
      // Don't fetch if zoomed out too far
      if (viewState.zoom < 9) {
          console.log("Zoom too low, skipping fetch");
          return;
      }

      const bounds = getBoundsFromMap();
      console.log("Fetching stations for bounds:", bounds);

      try {
        const queryParams = new URLSearchParams({
            min_lat: bounds.minLat.toString(),
            min_lon: bounds.minLon.toString(),
            max_lat: bounds.maxLat.toString(),
            max_lon: bounds.maxLon.toString(),
        });

        const response = await fetch(`http://localhost:8002/api/ev-stations?${queryParams}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const results = data.results || [];
        console.log("Stations fetched raw:", results.length);

        // Validate
        const validStations = results.filter((s: any) => s.position && s.position.lat && s.position.lon);
        console.log("Valid stations:", validStations.length);
        setStations(validStations);
      } catch (error) {
        console.error('Fetch error:', error);
        setErrorMsg(prev => prev + " API Fetch Error: " + String(error) + "; ");
      }
    };

  // Debounce fetch on move end
  useEffect(() => {
    const timer = setTimeout(() => {
        fetchStations();
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [viewState.latitude, viewState.longitude, viewState.zoom]);

  // MapLibre init
  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapRef.current) return;

    try {
        console.log("Initializing MapLibre...");
        // Use a simple raster style to avoid vector tile failures for now
        /*
        const simpleStyle: any = {
            version: 8,
            sources: {
                'cartodb-positron': {
                    type: 'raster',
                    tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                }
            },
            layers: [
                {
                    id: 'cartodb-positron',
                    type: 'raster',
                    source: 'cartodb-positron',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        };
        */
        const simpleStyle: any = {
            version: 8,
            sources: {
                'gsi-raster': {
                    type: 'raster',
                    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '出典：国土地理院（地理院地図） 地理院タイル（淡色地図）',
                }
            },
            layers: [
                {
                    id: 'gsi-raster',
                    type: 'raster',
                    source: 'gsi-raster',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        };

        mapRef.current = new maplibregl.Map({
          container: mapContainer.current,
          style: simpleStyle,
          center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
          zoom: INITIAL_VIEW_STATE.zoom,
        });

        mapRef.current.on('load', () => {
            console.log("Map Loaded Success");
            setMapLoaded(true);
        });

        mapRef.current.on('error', (e) => {
            console.error("Map Error Event:", e);
            setErrorMsg(prev => prev + " Map Error Event: " + JSON.stringify(e));
        });

    } catch (e) {
        console.error("Map Init Exception:", e);
        setErrorMsg(prev => prev + " Map Init Exception: " + String(e));
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync MapLibre with DeckGL viewState
  useEffect(() => {
    if (mapRef.current) {
        mapRef.current.jumpTo({
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          bearing: viewState.bearing,
          pitch: viewState.pitch
        });
    }
  }, [viewState]);

  const layers = useMemo(() => [
    new ScatterplotLayer({
      id: 'ev-stations-layer',
      data: stations,
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 4,
      radiusMaxPixels: 50,
      lineWidthMinPixels: 1,
      getPosition: (d: EVStation) => [d.position.lon, d.position.lat],
      getRadius: 20,
      getFillColor: [255, 0, 0, 255],
      getLineColor: [255, 255, 255],
      // Interaction: Click to select
      onClick: (info: any) => {
          if (info.object) {
              setSelectedStation(info.object);
              console.log("Selected:", info.object);
          }
      },
      // Hover: Cursor style
      onHover: (info: any) => {
          if (mapContainer.current) {
              mapContainer.current.style.cursor = info.object ? 'pointer' : 'grab';
          }
      }
    })
  ], [stations]);

  // Helper to render object data recursively
  const renderDataObj = (obj: any, depth = 0): React.ReactNode => {
      if (obj === null || obj === undefined) return <span style={{color: '#888'}}>null</span>;
      if (typeof obj !== 'object') return <span>{String(obj)}</span>;

      return (
          <div style={{ paddingLeft: depth * 10 }}>
              {Object.entries(obj).map(([key, value]) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 'bold', color: '#FF0000', fontSize: '0.9em' }}>{key}:</span>
                      <div style={{ marginLeft: '10px', wordBreak: 'break-all' }}>
                          {renderDataObj(value, depth + 1)}
                      </div>
                  </div>
              ))}
          </div>
      );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#333', overflow: 'hidden' }}>
      <div
        ref={mapContainer}
        style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 0
        }}
      />

      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }: any) => setViewState(viewState)}
        controller={true}
        layers={layers}
        width="100%"
        height="100%"
        style={{ zIndex: '1' }} // DeckGL on top
        // Minimal tooltip for quick ID
        getTooltip={({ object }: any) => object && {
          html: `<div style="padding: 4px;">${object.poi?.name || 'Station'}</div>`,
          style: { backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', fontSize: '12px' }
        }}
      />

      {/* Selected Station Detail Panel */}
      {selectedStation && (
          <div style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '350px',
              maxHeight: '80vh',
              overflowY: 'auto',
              backgroundColor: 'rgba(20, 20, 20, 0.95)',
              color: 'white',
              border: '1px solid #FF0000',
              borderRadius: '8px',
              padding: '16px',
              zIndex: 9999,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)'
          }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', borderBottom: '1px solid #444', paddingBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2em', color: '#fff' }}>{selectedStation.poi?.name || 'Station Details'}</h3>
                  <button
                    onClick={() => setSelectedStation(null)}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ff0000',
                        fontSize: '24px',
                        cursor: 'pointer',
                        lineHeight: '1',
                        padding: '0 4px'
                    }}
                  >×</button>
              </div>

              <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                  {renderDataObj(selectedStation)}
              </div>
          </div>
      )}


    </div>
  );
};

export default MapComponent;
