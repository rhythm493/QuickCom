import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { Map as MapIcon, Loader2 } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

type Service = 'blinkit' | 'zepto' | 'instamart'

interface Darkstore {
  id: number
  service: Service
  store_id: string
  is_active: number
  metadata_json: string | null
  last_verified_at: string | null
  created_at: string
  lat: number
  lon: number
  label: string
}

const SERVICE_MARKER_COLORS: Record<Service, string> = {
  blinkit: '#16a34a',
  zepto: '#9333ea',
  instamart: '#ea580c',
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

// Pune center
const PUNE_CENTER: [number, number] = [18.5204, 73.8567]

export function MapView() {
  const [darkstores, setDarkstores] = useState<Darkstore[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchDarkstores = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/darkstores`)
      if (res.ok) {
        const data = await res.json()
        setDarkstores(data.darkstores || [])
      }
    } catch (err) {
      console.error('Failed to fetch darkstores:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDarkstores()
  }, [fetchDarkstores])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapIcon className="h-6 w-6 text-orange-500" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Darkstore Map</h2>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {(Object.entries(SERVICE_MARKER_COLORS) as [Service, string][]).map(([svc, color]) => (
            <div key={svc} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
              <span className="text-gray-600 dark:text-gray-400 capitalize">{svc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700" style={{ height: '600px' }}>
        <MapContainer
          center={PUNE_CENTER}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {darkstores.map(store => (
            <CircleMarker
              key={`${store.service}-${store.store_id}`}
              center={[store.lat, store.lon]}
              radius={8}
              pathOptions={{
                fillColor: SERVICE_MARKER_COLORS[store.service],
                color: SERVICE_MARKER_COLORS[store.service],
                weight: 2,
                opacity: store.is_active ? 1 : 0.4,
                fillOpacity: store.is_active ? 0.7 : 0.3,
              }}
            >
              <Popup>
                <div className="text-sm min-w-[180px]">
                  <p className="font-bold capitalize mb-1">{store.service}</p>
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-medium">Store ID:</span>{' '}
                    <span className="font-mono">{store.store_id}</span>
                  </p>
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-medium">Location:</span> {store.label}
                  </p>
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-medium">Status:</span>{' '}
                    <span className={store.is_active ? 'text-green-600' : 'text-red-500'}>
                      {store.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </p>
                  {store.last_verified_at && (
                    <p className="text-xs text-gray-500">
                      Last verified: {new Date(store.last_verified_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {darkstores.length === 0 && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          No darkstores discovered yet. Go to Stores tab and click "Scan Pune" to discover darkstores.
        </p>
      )}
    </div>
  )
}
