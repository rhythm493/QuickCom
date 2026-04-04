import { useState, useEffect, useCallback } from 'react'
import { Store, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Service = 'blinkit' | 'zepto' | 'instamart'

interface Darkstore {
  id: number
  service: Service
  store_id: string
  location_id: number
  is_active: number
  metadata_json: string | null
  last_verified_at: string | null
  created_at: string
  lat: number
  lon: number
  label: string
}

interface DarkstoreStats {
  total: number
  byService: Record<string, number>
  byCity: Record<string, number>
}

interface ScanProgress {
  service: string
  neighborhood: string
  storesFound: number
  totalPoints: number
  currentPoint: number
  done: boolean
}

interface StoresViewProps {
  wsRef: React.RefObject<WebSocket | null>
}

const SERVICE_COLORS: Record<Service, string> = {
  blinkit: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  zepto: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
  instamart: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function StoresView({ wsRef }: StoresViewProps) {
  const [darkstores, setDarkstores] = useState<Darkstore[]>([])
  const [stats, setStats] = useState<DarkstoreStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isScanning, setIsScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [filterService, setFilterService] = useState<Service | 'all'>('all')

  const fetchDarkstores = useCallback(async () => {
    try {
      const [storesRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/darkstores`),
        fetch(`${API_BASE}/api/darkstores/stats`),
      ])
      if (storesRes.ok) {
        const data = await storesRes.json()
        setDarkstores(data.darkstores || [])
      }
      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats({ total: data.total, byService: data.byService, byCity: data.byCity })
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

  // Listen for scan progress over WebSocket
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'scan-progress') {
          setScanProgress(data)
        } else if (data.type === 'scan-complete') {
          setIsScanning(false)
          setScanProgress(null)
          fetchDarkstores()
        } else if (data.type === 'scan-error') {
          setIsScanning(false)
          setScanProgress(null)
        }
      } catch {
        // ignore
      }
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [wsRef, fetchDarkstores])

  const handleScan = async () => {
    setIsScanning(true)
    setScanProgress(null)
    try {
      await fetch(`${API_BASE}/api/scan-city`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: 'pune' }),
      })
    } catch (err) {
      console.error('Failed to start scan:', err)
      setIsScanning(false)
    }
  }

  const filtered = filterService === 'all'
    ? darkstores
    : darkstores.filter(d => d.service === filterService)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="h-6 w-6 text-orange-500" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Darkstores</h2>
        </div>
        <Button
          onClick={handleScan}
          disabled={isScanning}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          {isScanning ? (
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Scanning...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Scan Pune
            </span>
          )}
        </Button>
      </div>

      {/* Scan Progress */}
      {isScanning && scanProgress && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Scanning {scanProgress.service} - {scanProgress.neighborhood}
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-400">
              {scanProgress.currentPoint}/{scanProgress.totalPoints} points | {scanProgress.storesFound} stores found
            </span>
          </div>
          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
            <div
              className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(scanProgress.currentPoint / scanProgress.totalPoints) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Stores</p>
          </div>
          {(['blinkit', 'zepto', 'instamart'] as Service[]).map(svc => (
            <div key={svc} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.byService[svc] || 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{svc}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">Filter:</span>
        {(['all', 'blinkit', 'zepto', 'instamart'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilterService(f)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              filterService === f
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Service</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Store ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Last Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No darkstores found. Click "Scan Pune" to discover stores.
                  </td>
                </tr>
              ) : (
                filtered.map(store => (
                  <tr key={store.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${SERVICE_COLORS[store.service]}`}>
                        {store.service}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-[200px] truncate" title={store.store_id}>
                      {store.store_id}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {store.label || `${store.lat.toFixed(4)}, ${store.lon.toFixed(4)}`}
                    </td>
                    <td className="px-4 py-3">
                      {store.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 dark:text-red-400">
                          <XCircle className="h-4 w-4" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {store.last_verified_at
                        ? new Date(store.last_verified_at).toLocaleString()
                        : 'Never'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
