import { useEffect, useState, useCallback } from 'react'
import { Database, RefreshCw, Package, Clock } from 'lucide-react'

interface CacheStats {
  totalEntries: number
  freshEntries: number
  staleEntries: number
  expiredEntries: number
  totalProducts: number
  totalPriceHistory: number
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function CacheStatsCard() {
  const [stats, setStats] = useState<CacheStats | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cache-stats`)
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to fetch cache stats:', err)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [fetchStats])

  if (!stats) return null

  const items = [
    { label: 'Cache Entries', value: stats.totalEntries, icon: Database, color: 'text-blue-500' },
    { label: 'Fresh', value: stats.freshEntries, icon: Clock, color: 'text-green-500' },
    { label: 'Stale', value: stats.staleEntries, icon: RefreshCw, color: 'text-amber-500' },
    { label: 'Products Tracked', value: stats.totalProducts, icon: Package, color: 'text-purple-500' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
      ))}
    </div>
  )
}
