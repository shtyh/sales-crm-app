import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './lib/auth'
import './App.css'

// Each page is its own JS chunk — the user only downloads what they actually
// visit. Named exports → wrap with .then(...) so React.lazy gets a default.
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const BookingsPage = lazy(() =>
  import('./pages/BookingsPage').then((m) => ({ default: m.BookingsPage })),
)
const NewBookingPage = lazy(() =>
  import('./pages/NewBookingPage').then((m) => ({ default: m.NewBookingPage })),
)
const BookingDetailPage = lazy(() =>
  import('./pages/BookingDetailPage').then((m) => ({
    default: m.BookingDetailPage,
  })),
)
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })),
)
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({
    default: m.AdminDashboardPage,
  })),
)
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage').then((m) => ({
    default: m.AdminUsersPage,
  })),
)
const CarsPage = lazy(() =>
  import('./pages/CarsPage').then((m) => ({ default: m.CarsPage })),
)
const NewCarPage = lazy(() =>
  import('./pages/NewCarPage').then((m) => ({ default: m.NewCarPage })),
)
const CarDetailPage = lazy(() =>
  import('./pages/CarDetailPage').then((m) => ({
    default: m.CarDetailPage,
  })),
)
const FinancePage = lazy(() =>
  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
)
const CommissionSchedulesPage = lazy(() =>
  import('./pages/CommissionSchedulesPage').then((m) => ({
    default: m.CommissionSchedulesPage,
  })),
)
const CommissionsPage = lazy(() =>
  import('./pages/CommissionsPage').then((m) => ({
    default: m.CommissionsPage,
  })),
)
const CustomersPage = lazy(() =>
  import('./pages/CustomersPage').then((m) => ({
    default: m.CustomersPage,
  })),
)

function RouteFallback() {
  return (
    <div className="grid min-h-screen place-items-center text-gray-500">
      Loading…
    </div>
  )
}

/**
 * Renders the right home page based on the signed-in user's role.
 *   finance_admin → /finance (inventory + LOU)
 *   any other privileged role → admin overview
 *   sales_advisor → personal sales dashboard
 */
function RoleHome() {
  const { role, isAdmin } = useAuth()
  if (role === 'finance_admin') return <Navigate to="/finance" replace />
  return isAdmin ? <AdminDashboardPage /> : <DashboardPage />
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public sign-up is disabled — accounts are created by invitation. */}
        <Route path="/signup" element={<Navigate to="/login" replace />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bookings"
          element={
            <ProtectedRoute>
              <BookingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bookings/new"
          element={
            <ProtectedRoute>
              <NewBookingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bookings/:id"
          element={
            <ProtectedRoute>
              <BookingDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cars"
          element={
            <ProtectedRoute>
              <CarsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cars/new"
          element={
            <ProtectedRoute>
              <NewCarPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cars/:id"
          element={
            <ProtectedRoute>
              <CarDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance"
          element={
            <ProtectedRoute>
              <FinancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/commissions"
          element={
            <ProtectedRoute>
              <CommissionSchedulesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/commissions"
          element={
            <ProtectedRoute>
              <CommissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute>
              <CustomersPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
