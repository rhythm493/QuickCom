import { useState } from 'react'
import { BarChart3, Search, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PriceChart } from './PriceChart'
import { CacheStatsCard } from './CacheStatsCard'

type Service = 'blinkit' | 'zepto' | 'instamart'

interface PricePoint {
  price_paise: number
  mrp_paise: number | null
  recorded_at: string
}

interface BestPriceResult {
  service: Service
  product_name: string
  price_paise: number
  price_display: string
  darkstore_id: number
}

const SERVICE_COLORS: Record<Service, string> = {
  blinkit: '#16a34a',
  zepto: '#9333ea',
  instamart: '#ea580c',
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function AnalyticsView() {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [priceHistoryData, setPriceHistoryData] = useState<Record<string, PricePoint[]>>({})
  const [bestPrices, setBestPrices] = useState<BestPriceResult[]>([])
  const [searchedQuery, setSearchedQuery] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsLoading(true)
    setSearchedQuery(query)

    try {
      // Fetch best prices
      const bestPriceRes = await fetch(`${API_BASE}/api/best-price?query=${encodeURIComponent(query)}&locationId=1`)
      if (bestPriceRes.ok) {
        const data = await bestPriceRes.json()
        setBestPrices(data.results || [])

        // Fetch price history for each product found
        const historyMap: Record<string, PricePoint[]> = {}
        for (const result of (data.results || [])) {
          try {
            const histRes = await fetch(
              `${API_BASE}/api/price-history?service=${result.service}&productId=${result.darkstore_id}&days=30`
            )
            if (histRes.ok) {
              const histData = await histRes.json()
              historyMap[result.service] = histData.history || []
            }
          } catch {
            // ignore individual failures
          }
        }
        setPriceHistoryData(historyMap)
      }
    } catch (err) {
      console.error('Analytics search failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const bestPriceChartData = bestPrices.map(bp => ({
    service: bp.service.charAt(0).toUpperCase() + bp.service.slice(1),
    price: bp.price_paise / 100,
    rawService: bp.service,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-orange-500" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Analytics</h2>
      </div>

      {/* Cache Stats */}
      <CacheStatsCard />

      {/* Product Search */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Price Analysis</h3>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search product for price analysis..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-10 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>
          <Button type="submit" disabled={isLoading || !query.trim()} className="bg-orange-500 hover:bg-orange-600 text-white">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Analyze'}
          </Button>
        </form>
      </div>

      {/* Best Price Comparison */}
      {bestPrices.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Best Price for "{searchedQuery}"
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bestPriceChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="service" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `\u20B9${v}`} />
              <Tooltip
                formatter={(value) => [`\u20B9${Number(value).toFixed(2)}`, 'Price']}
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
              />
              <Bar dataKey="price" radius={[4, 4, 0, 0]}>
                {bestPriceChartData.map((entry, index) => (
                  <Cell key={index} fill={SERVICE_COLORS[entry.rawService as Service] || '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Price History Charts */}
      {Object.entries(priceHistoryData).map(([service, data]) => (
        data.length > 0 && (
          <PriceChart
            key={service}
            data={data}
            service={service}
            productName={searchedQuery}
          />
        )
      ))}

      {searchedQuery && bestPrices.length === 0 && !isLoading && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <p>No price data found for "{searchedQuery}".</p>
          <p className="text-sm mt-1">Try searching for products first to build cache data.</p>
        </div>
      )}
    </div>
  )
}
