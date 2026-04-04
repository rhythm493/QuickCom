"use client"

import { useState, useEffect, useRef } from "react"
import { SearchForm } from "@/components/SearchForm"
import { ProductList } from "@/components/ProductList"
import { LoadingIndicator } from "@/components/loading-indicator"
import { Dashboard } from "@/components/Dashboard"
import { MapView } from "@/components/MapView"
import { AnalyticsView } from "@/components/AnalyticsView"
import { StoresView } from "@/components/StoresView"
import { Package2, AlertCircle, MapPin } from "lucide-react"
import { Toaster, toast } from "react-hot-toast"
import { ThemeToggle } from "@/components/ThemeToggle"

const getWebsocketUrl = () => {
  const isProduction = import.meta.env.PROD;
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  if (isProduction && typeof window !== "undefined") {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  return "ws://localhost:5000";
}
const WS_URL = getWebsocketUrl();
type Service = "blinkit" | "zepto" | "instamart"

interface Product {
  id: string
  name: string
  price: string
  originalPrice: string | null
  savings: string | null
  quantity: string
  deliveryTime: string
  discount: string | null
  imageUrl: string
  available: boolean
  source?: Service
}

type ServiceStatus = "pending" | "loading" | "success" | "error" | "empty"
interface ServiceState {
  status: ServiceStatus
  message: string
  products: Product[]
  isLoading: boolean
  logo: string
  color: string
  cached: boolean
  stale: boolean
}

export default function Home() {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)
  const [isLoadingSearch, setIsLoadingSearch] = useState(false)
   const [isLocationSet, setIsLocationSet] = useState(false)
   const [currentLocation, setCurrentLocation] = useState<string | null>(null)
  const [loadingMessage, setLoadingMessage] = useState("")

  const [services, setServices] = useState<Record<Service, ServiceState>>({
    blinkit: {
      status: "pending",
      message: "Ready",
      products: [],
      isLoading: false,
      logo: "/src/assets/blinkit.png",
      color: "green",
      cached: false,
      stale: false,
    },
    zepto: {
      status: "pending",
      message: "Ready",
      products: [],
      isLoading: false,
      logo: "/src/assets/zepto.png",
      color: "purple",
      cached: false,
      stale: false,
    },
    instamart: {
      status: "pending",
      message: "Ready",
      products: [],
      isLoading: false,
      logo: "/src/assets/instamart.png",
      color: "orange",
      cached: false,
      stale: false,
    }
  })
    const [activeService, setActiveService] = useState<Service | null>(null)
  const [error, setError] = useState("")

  const ws = useRef<WebSocket | null>(null)

  useEffect(() => {
    const initializeWebSocket = () => {
      try {
        ws.current = new WebSocket(WS_URL)

        ws.current.onopen = () => {
          setIsConnected(true)
          setError("")
          setIsLoading(false)
          setLoadingMessage("")
          toast.success("Connected to server!", {
            icon: "🚀",
            style: {
              background: '#22c55e',
              color: 'white',
            }
          })
        }

        ws.current.onclose = (event) => {
          setIsConnected(false)

          if (!event.wasClean) {
            toast.error("Connection lost. Reconnecting...", {
              icon: "🔌",
              style: {
                background: '#ef4444',
                color: 'white',
              }
            })
            setTimeout(() => {
              if (ws.current?.readyState === WebSocket.CLOSED) {
                initializeWebSocket()
              }
            }, 3000)
          }
        }

        ws.current.onerror = (error) => {
          console.error("WebSocket Error:", error)
          setIsConnected(false)
          setError(
            "Connection error. Server might be unavailable.",
          )
          toast.error("Connection error. Please try again.", {
            icon: "❌",
            style: {
              background: '#ef4444',
              color: 'white',
            }
          })
          setIsLoading(false)
        }

        ws.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log("Received message:", data)

            // Handle new message format with 'type' field (for Blinkit hybrid)
            if (data.type === "connected") {
              console.log("Connection acknowledged, client ID:", data.cid)
              return
            }

            // Scan progress/completion messages are handled by StoresView via addEventListener
            if (data.type === "scan-progress" || data.type === "scan-complete" || data.type === "scan-error") {
              return
            }

            if (data.type === "location-set") {
              const svc = data.svc as Service

               // Update location set status for this service
               setIsLocationSet(true)
               setIsLoadingLocation(false)
               setLoadingMessage("")
               setCurrentLocation(data.loc || "Location set")

              toast.success(`Location set for ${svc}!`, {
                icon: "📍",
                style: {
                  background: '#10b981',
                  color: 'white',
                }
              })
              return
            }

            if (data.type === "search-results") {
              setIsLoadingSearch(false)
              setLoadingMessage("")

              const service = data.svc as Service
              const products = data.products || []
              const isCached = data.cached === true
              const isStale = data.stale === true

              setServices(prev => ({
                ...prev,
                [service]: {
                  ...prev[service],
                  products: products,
                  status: products.length > 0 ? "success" : "empty",
                  isLoading: false,
                  cached: isCached,
                  stale: isStale,
                  message: products.length > 0
                    ? `Found ${products.length} products${isCached ? ' (cached)' : ''}`
                    : "No products found"
                }
              }))

              if (products.length > 0) {
                toast.success(`Found ${products.length} products on ${service}!`, {
                  icon: "🛍️",
                  style: {
                    background: '#3b82f6',
                    color: 'white',
                  }
                })
              } else {
                toast("No products found.", {
                  icon: '🤔',
                  style: {
                    background: '#fef3c7',
                    color: '#92400e'
                  }
                })
              }
              return
            }

            if (data.type === "error") {
              setError(data.error || "An error occurred")
              toast.error(data.error || "An error occurred", { icon: "🔥" })
              setIsLoading(false)
              setIsLoadingLocation(false)
              setIsLoadingSearch(false)
              setLoadingMessage("")
              return
            }

            // Handle old message format with 'action' field (for backward compatibility)
            if (data.action === "statusUpdate") {
              if (data.message) {
                setLoadingMessage(data.message)
              }

              if (data.step === "initialize") {
                if (data.status === "completed" && data.success) {
                  setIsLoading(false)
                  setLoadingMessage("")
                  toast.success(data.message || "Browsers initialized.", {
                    icon: "👍",
                     style: {
                        background: '#10b981',
                        color: 'white',
                      }
                  })
                } else if (data.status === "error") {
                  setError(data.message || "Failed to initialize browsers.")
                  toast.error(data.message || "Browser init failed.", { icon: "🙁" })
                  setIsLoading(false)
                  setLoadingMessage("")
                }
              } else if (data.step === "setLocation") {
                setIsLoadingLocation(data.status === "loading")
                if (data.status === "completed") {
                  if (data.success) {
                    setIsLocationSet(true)
                     if (data.locationResults) {
                       const locationMessages = data.locationResults
                         .map((r: { service: string; success: boolean }) => `${r.service}: ${r.success ? '✅' : '❌'}`)
                         .join(', ')
                       setCurrentLocation(`${locationMessages}`)
                       toast.success(`Location set! ${locationMessages}`, {
                         icon: "📍",
                         style: {
                          background: '#10b981',
                          color: 'white',
                        }
                      })
                    } else {
                      setCurrentLocation("Set on one or more services")
                      toast.success(data.message || "Location set!", {
                        icon: "📍",
                        style: {
                          background: '#10b981',
                          color: 'white',
                        }
                      })
                    }
                  } else {
                    setIsLocationSet(false)
                    setCurrentLocation(null)
                    toast.error(data.message || "Failed to set location.", { icon: "🗺️❌" })
                  }
                } else if (data.status === "error") {
                  setIsLocationSet(false)
                  setCurrentLocation(null)
                  toast.error(data.message || "Error setting location.", { icon: "🗺️🔥" })
                }
              } else if (data.step === "search") {
                setIsLoadingSearch(data.status === "loading")
                if (data.status === "completed") {
                  setIsLoadingSearch(false)
                  setLoadingMessage("")
                } else if (data.status === "error") {
                  setError(data.message || `Search error`)
                  setIsLoadingSearch(false)
                  setLoadingMessage("")
                  toast.error(data.message || "Search error", { icon: "🔍❌" })
                }
              }
              return
            }
            if (data.action === "serviceSearchUpdate") {
              const { service, status, message } = data

              if (service && ["blinkit", "zepto", "instamart"].includes(service)) {
                setServices(prev => ({
                  ...prev,
                  [service]: {
                    ...prev[service as Service],
                    status: status as ServiceStatus,
                    message: message || prev[service as Service].message,
                    isLoading: status === "loading" || status === "navigating" || status === "extracting"
                  }
                }))

                if (status === "error") {
                  toast.error(`${service}: ${message}`, {
                    duration: 2000,
                    style: { background: '#fee2e2' }
                  })
                }
              }
              return
            }

            if (data.status === "error") {
              setError(data.message || `Error: ${data.action || 'unknown'}`)
              toast.error(data.message || `Error: ${data.action || 'operation'}`, { icon: "🔥" })
              setIsLoading(false)
              setIsLoadingLocation(false)
              setIsLoadingSearch(false)
              setLoadingMessage("")
              return
            }

            switch (data.action) {
              case "searchResults":
                setIsLoadingSearch(false)
                setLoadingMessage("")

                if (data.products) {
                  setServices(prev => ({
                    blinkit: {
                      ...prev.blinkit,
                      products: data.products.blinkit || [],
                      status: data.products.blinkit?.length > 0 ? "success" : "empty",
                      isLoading: false,
                      message: data.products.blinkit?.length > 0
                        ? `Found ${data.products.blinkit.length} products`
                        : "No products found"
                    },
                    zepto: {
                      ...prev.zepto,
                      products: data.products.zepto || [],
                      status: data.products.zepto?.length > 0 ? "success" : "empty",
                      isLoading: false,
                      message: data.products.zepto?.length > 0
                        ? `Found ${data.products.zepto.length} products`
                        : "No products found"
                    },
                    instamart: {
                      ...prev.instamart,
                      products: data.products.instamart || [],
                      status: data.products.instamart?.length > 0 ? "success" : "empty",
                      isLoading: false,
                      message: data.products.instamart?.length > 0
                        ? `Found ${data.products.instamart.length} products`
                        : "No products found"
                    }
                  }))

                  const totalCount = data.productCount?.total || 0

                  if (totalCount > 0) {
                    toast.success(`Found ${totalCount} products across all services!`, {
                      icon: "🛍️",
                      style: {
                          background: '#3b82f6',
                          color: 'white',
                        }
                    })
                  } else {
                    toast("No products found on any service.", {
                      icon: '🤔',
                      style: {
                        background: '#fef3c7',
                        color: '#92400e'
                      }
                    })
                  }
                }
                break

              default:
                console.warn("Received unhandled message:", data)
                break
            }
          } catch (parseError) {
            console.error("Error parsing WebSocket message:", parseError)
            setError("Error processing server response.")
            toast.error("Error processing server response.", { icon: "🤯" })
            setIsLoading(false)
            setLoadingMessage("")
          }
        }
      } catch (error) {
        console.error("Error creating WebSocket connection:", error)
        setError("Failed to establish connection. Please refresh the page or try again later.")
        toast.error("Failed to establish connection")
        setIsConnected(false)
        setIsLoading(false)
      }
    }

    initializeWebSocket()

    return () => {
      if (ws.current) {
        const socket = ws.current
        socket.onclose = null
        socket.close()
        ws.current = null
      }
    }
  }, [])

  const handleSetLocation = (location: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      toast.error("Connection not ready. Please wait.")
      return
    }
    try {
      setIsLoadingLocation(true)
      setCurrentLocation(null)
      setLoadingMessage(`Setting location to ${location}...`)

      // Send location set request for all services
      const services: Service[] = ["blinkit", "zepto", "instamart"]
      services.forEach(service => {
        ws.current?.send(
          JSON.stringify({
            type: "set-location",
            service,
            location,
          }),
        )
      })
    } catch (error) {
      console.error("Error sending setLocation request:", error)
      toast.error("Failed to send setLocation request.")
      setIsLoadingLocation(false)
    }
  }

  const handleSearch = (searchTerm: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      toast.error("Connection not ready. Please wait.")
      return
    }
    if (!isLocationSet) {
      toast.error("Please set the location before searching.")
      return
    }

    try {
      // Set all services to loading state, reset cache flags
      setServices(prev => ({
        blinkit: { ...prev.blinkit, status: "loading", isLoading: true, message: "Searching...", cached: false, stale: false },
        zepto: { ...prev.zepto, status: "loading", isLoading: true, message: "Searching...", cached: false, stale: false },
        instamart: { ...prev.instamart, status: "loading", isLoading: true, message: "Searching...", cached: false, stale: false }
      }))

      setIsLoadingSearch(true)
      setLoadingMessage(`Searching for "${searchTerm}" on all services...`)

      // Send search request for all services
      const services: Service[] = ["blinkit", "zepto", "instamart"]
      services.forEach(service => {
        ws.current?.send(
          JSON.stringify({
            type: "search",
            service,
            query: searchTerm,
          }),
        )
      })
    } catch (error) {
      console.error("Error sending search request:", error)
      toast.error("Failed to send search request.")
      setIsLoadingSearch(false)
    }
  }

  // Search view content (existing functionality)
  const searchView = (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 text-red-500 dark:text-red-400" />
          <span>{error}</span>
        </div>
      )}
      <SearchForm
        onSetLocation={handleSetLocation}
        onSearch={handleSearch}
        disabled={!isConnected || isLoading}
        isLoadingLocation={isLoadingLocation}
        isLoadingSearch={isLoadingSearch}
        isLocationSet={isLocationSet}
        currentLocation={currentLocation}
      />
      {(isLoading || isLoadingSearch) && loadingMessage && (
        <LoadingIndicator message={loadingMessage} />
      )}

      <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
        <ul className="flex flex-wrap -mb-px text-sm font-medium text-center">
          <li className="mr-2">
            <button
              className={`inline-block p-4 rounded-t-lg transition-colors duration-200 ${activeService === null ? 'border-b-2 border-yellow-500 text-yellow-600 dark:text-yellow-400 font-semibold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`}
              onClick={() => setActiveService(null)}
            >
              All Services
            </button>
          </li>
          {Object.entries(services).map(([service, data]) => (
            <li className="mr-2" key={service}>
              <button
                className={`inline-block p-4 rounded-t-lg transition-colors duration-200 ${activeService === service ? `border-b-2 border-${data.color}-500 text-${data.color}-600 dark:text-${data.color}-400 font-semibold` : 'text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`}
                onClick={() => setActiveService(service as Service)}
              >
                {service.charAt(0).toUpperCase() + service.slice(1)}
                {data.isLoading && (
                  <span className="ml-2 inline-block w-4 h-4 border-2 border-t-transparent border-green-500 rounded-full animate-spin"></span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {activeService === null ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {Object.entries(services).map(([service, data]) => (
            <div key={service} className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold capitalize flex items-center text-gray-900 dark:text-gray-100">
                  <img src={data.logo} alt={`${service} logo`} className="h-6 w-auto mr-2" />
                  {service}
                  {data.isLoading && (
                    <span className="ml-2 inline-block w-4 h-4 border-2 border-t-transparent border-green-500 rounded-full animate-spin"></span>
                  )}
                </h2>
                <span className={`text-sm px-2 py-1 rounded ${data.status === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' :
                  data.status === 'error' ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300' :
                  data.status === 'empty' ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300' :
                  'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300'}`}>
                  {data.products.length} items
                </span>
              </div>
              <ProductList
                products={data.products}
                isCompact={true}
                serviceName={service as Service}
                isLoading={data.isLoading}
                cached={data.cached}
                stale={data.stale}
              />
            </div>
          ))}
        </div>
      ) : (
        <div>
          <ProductList
            products={services[activeService].products}
            serviceName={activeService}
            isLoading={services[activeService].isLoading}
            cached={services[activeService].cached}
            stale={services[activeService].stale}
          />
        </div>
      )}
    </>
  )

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-900 flex flex-col transition-colors duration-200">
      <Toaster position="top-center" reverseOrder={false} />
      <header className="bg-orange-500 dark:bg-gray-800 text-white shadow-md sticky top-0 z-50 transition-colors duration-200">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center">
            <Package2 className="h-7 w-7 mr-2 text-white" />
            <h1 className="text-lg sm:text-xl font-bold">QuickCom</h1>
          </div>
          <div className="flex items-center space-x-3">
            {isLocationSet && currentLocation && (
              <div className="hidden sm:flex items-center p-2 bg-orange-400 dark:bg-gray-700 rounded-md">
                <MapPin className="h-4 w-4 mr-1.5" />
                <span className="text-xs font-medium">{currentLocation}</span>
              </div>
            )}
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} title={isConnected ? 'Connected' : 'Disconnected'} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <Dashboard
        searchView={searchView}
        mapView={<MapView />}
        analyticsView={<AnalyticsView />}
        storesView={<StoresView wsRef={ws} />}
      />
    </div>
  )
}
