import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface PricePoint {
  price_paise: number
  mrp_paise: number | null
  recorded_at: string
}

interface PriceChartProps {
  data: PricePoint[]
  service: string
  productName?: string
}

const SERVICE_COLORS: Record<string, string> = {
  blinkit: '#16a34a',
  zepto: '#9333ea',
  instamart: '#ea580c',
}

export function PriceChart({ data, service, productName }: PriceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-500 dark:text-gray-400">No price history data available</p>
      </div>
    )
  }

  const chartData = data.map(point => ({
    date: new Date(point.recorded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    price: point.price_paise / 100,
    mrp: point.mrp_paise ? point.mrp_paise / 100 : null,
  }))

  const color = SERVICE_COLORS[service] || '#6b7280'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      {productName && (
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {productName} - <span className="capitalize">{service}</span>
        </h3>
      )}
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `\u20B9${v}`} />
          <Tooltip
            formatter={(value) => [`\u20B9${Number(value).toFixed(2)}`, '']}
            labelStyle={{ fontWeight: 'bold' }}
            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Price"
          />
          {chartData.some(d => d.mrp !== null) && (
            <Line
              type="monotone"
              dataKey="mrp"
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="5 5"
              dot={false}
              name="MRP"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
