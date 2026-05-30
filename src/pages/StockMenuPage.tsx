import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { usePartsStats } from '../lib/queries'

type Tile = {
  title: string
  subtitle: string
  icon: string
  to?: string
  badge?: string
}

/**
 * Workshop Stock Menu — landing for the Stock Control tile. Mirrors the
 * legacy WMS "Stock Menu" screen (Purchase Order / Stock Received /
 * Stock Issued / FIFO Costing Re-Calculate / WIP Re-Calculate), plus a
 * Parts List tile that opens the closing-stock report against the 1,615
 * rows imported from the legacy XLS.
 *
 * Routes:
 *   /service/stock           → this menu (StockMenuPage)
 *   /service/stock/closing   → StockOnHandPage (Closing Stock report)
 *
 * Other tiles render with a "Coming soon" badge until purchase-order
 * intake + a stock-movements ledger land.
 */
export function StockMenuPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  // Server-aggregated stats. parts_inventory is ~80k rows after the
  // AUTFTP02 import — fetching the catalogue just to count it would blow
  // the PostgREST 1000-row cap and silently misreport. SQL aggregate via
  // parts_inventory_stats() RPC instead.
  const { data: stats } = usePartsStats()
  const totals = {
    total: stats?.total ?? 0,
    active: stats?.active ?? 0,
    valueRm: stats?.value_rm ?? 0,
    lowStock: stats?.low_stock ?? 0,
  }

  const tiles: Tile[] = [
    {
      title: 'Closing Stock Report',
      subtitle: 'On-hand quantity + value by group',
      icon: '📦',
      to: '/service/stock/closing',
    },
    {
      title: 'Parts List',
      subtitle: 'Browse + edit the part catalogue',
      icon: '📋',
      to: '/service/stock/parts',
    },
    {
      title: 'Purchase Order',
      subtitle: 'Raise POs against suppliers',
      icon: '🛒',
      badge: 'Coming soon',
    },
    {
      title: 'Stock Received',
      subtitle: 'Book in items from a supplier delivery',
      icon: '📥',
      to: '/service/stock/receive',
    },
    {
      title: 'Stock Issued',
      subtitle: 'Parts issued to jobs, by date range',
      icon: '📤',
      to: '/service/stock/issued',
    },
    {
      title: 'FIFO / WIP Re-Calculate',
      subtitle: 'Re-cost stock and WIP after movements',
      icon: '🧮',
      badge: 'Coming soon',
    },
  ]

  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-5 text-white sm:px-6 sm:py-6">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
            Workshop Management System
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Stock Menu</h1>
          <p className="mt-1 text-sm text-slate-200">
            Manage parts, purchases, and inventory movements.
          </p>
        </div>
      </div>

      {/* Quick stats — sourced live from parts_inventory */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Parts catalogued" value={totals.total} tone="neutral" />
        <Counter label="Active" value={totals.active} tone="green" />
        <Counter
          label="Total value (RM)"
          value={totals.valueRm.toLocaleString('en-MY', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          tone="neutral"
        />
        <Counter
          label="At / below reorder level"
          value={totals.lowStock}
          tone={totals.lowStock > 0 ? 'amber' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <TileCard key={t.title} tile={t} />
        ))}
      </div>
    </AppShell>
  )
}

function TileCard({ tile }: { tile: Tile }) {
  const wired = !!tile.to
  const body = (
    <div
      className={`group flex h-full flex-col rounded-2xl border bg-white p-5 transition ${
        wired
          ? 'border-gray-200 shadow-sm hover:-translate-y-0.5 hover:border-gray-900 hover:shadow-md'
          : 'border-dashed border-gray-200 opacity-70'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="text-3xl">{tile.icon}</span>
        {tile.badge && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {tile.badge}
          </span>
        )}
      </div>
      <div className="mt-4 text-base font-semibold text-gray-900">
        {tile.title}
      </div>
      <div className="mt-1 text-xs text-gray-500">{tile.subtitle}</div>
      {wired && (
        <div className="mt-4 text-xs font-medium text-gray-900 opacity-0 transition group-hover:opacity-100">
          Open →
        </div>
      )}
    </div>
  )
  return wired && tile.to ? (
    <Link to={tile.to} className="block">
      {body}
    </Link>
  ) : (
    <div aria-disabled="true">{body}</div>
  )
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: 'amber' | 'green' | 'neutral'
}) {
  const t = {
    amber: 'text-amber-700',
    green: 'text-green-700',
    neutral: 'text-gray-900',
  }[tone]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${t}`}>
        {value}
      </div>
    </div>
  )
}
