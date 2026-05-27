import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './lib/auth'
import { useWorkspace } from './lib/workspace'
import './App.css'

// Workshop roles get the service dashboard as their home. super_admin
// gets it too whenever they've toggled into Service workspace.
const WORKSHOP_ROLES = [
  'service_manager',
  'service_advisor',
  'store_keeper',
  'mechanic',
] as const

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
const GeneralAdminDashboardPage = lazy(() =>
  import('./pages/GeneralAdminDashboardPage').then((m) => ({
    default: m.GeneralAdminDashboardPage,
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
const VehiclesPage = lazy(() =>
  import('./pages/VehiclesPage').then((m) => ({
    default: m.VehiclesPage,
  })),
)
const NewVehiclePage = lazy(() =>
  import('./pages/NewVehiclePage').then((m) => ({
    default: m.NewVehiclePage,
  })),
)
const VehicleDetailPage = lazy(() =>
  import('./pages/VehicleDetailPage').then((m) => ({
    default: m.VehicleDetailPage,
  })),
)
const ServiceDashboardPage = lazy(() =>
  import('./pages/ServiceDashboardPage').then((m) => ({
    default: m.ServiceDashboardPage,
  })),
)
const ServiceOpsPage = lazy(() =>
  import('./pages/ServiceOpsPage').then((m) => ({
    default: m.ServiceOpsPage,
  })),
)
const BillingPage = lazy(() =>
  import('./pages/BillingPage').then((m) => ({
    default: m.BillingPage,
  })),
)
const QuotationPage = lazy(() =>
  import('./pages/QuotationPage').then((m) => ({
    default: m.QuotationPage,
  })),
)
const BillPrintPage = lazy(() =>
  import('./pages/BillPrintPage').then((m) => ({
    default: m.BillPrintPage,
  })),
)
const ClockInPage = lazy(() =>
  import('./pages/ClockInPage').then((m) => ({ default: m.ClockInPage })),
)
const MyAttendancePage = lazy(() =>
  import('./pages/MyAttendancePage').then((m) => ({
    default: m.MyAttendancePage,
  })),
)
const TeamAttendancePage = lazy(() =>
  import('./pages/TeamAttendancePage').then((m) => ({
    default: m.TeamAttendancePage,
  })),
)
const NewServiceOrderPage = lazy(() =>
  import('./pages/NewServiceOrderPage').then((m) => ({
    default: m.NewServiceOrderPage,
  })),
)
const ServiceOrderDetailPage = lazy(() =>
  import('./pages/ServiceOrderDetailPage').then((m) => ({
    default: m.ServiceOrderDetailPage,
  })),
)
const BookPage = lazy(() =>
  import('./pages/BookPage').then((m) => ({ default: m.BookPage })),
)
const StaffBookPage = lazy(() =>
  import('./pages/BookPage').then((m) => ({ default: m.StaffBookPage })),
)
const BookStatusPage = lazy(() =>
  import('./pages/BookStatusPage').then((m) => ({
    default: m.BookStatusPage,
  })),
)
const ServiceAppointmentsPage = lazy(() =>
  import('./pages/ServiceAppointmentsPage').then((m) => ({
    default: m.ServiceAppointmentsPage,
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
 *   workshop roles → service dashboard
 *   super_admin in Service workspace → service dashboard (per the toggle)
 *   finance_admin → /finance (inventory + LOU)
 *   any other privileged role → admin overview
 *   sales_advisor → personal sales dashboard
 */
function RoleHome() {
  const { role, isAdmin } = useAuth()
  const { workspace } = useWorkspace()

  // Every workshop role — service_advisor, service_manager, store_keeper,
  // mechanic — lands on the WMS-style tile menu so they all see the
  // same home. The advisor's own queue is one click into Job Sheet /
  // Billing from there.
  if (
    role &&
    (WORKSHOP_ROLES as readonly string[]).includes(role)
  ) {
    return <ServiceDashboardPage />
  }
  if (role === 'super_admin' && workspace === 'service') {
    return <ServiceDashboardPage />
  }
  if (role === 'finance_admin') return <Navigate to="/finance" replace />
  if (role === 'general_admin') return <GeneralAdminDashboardPage />
  return isAdmin ? <AdminDashboardPage /> : <DashboardPage />
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public sign-up is disabled — accounts are created by invitation. */}
        <Route path="/signup" element={<Navigate to="/login" replace />} />

        {/* Customer-facing service booking — no auth required. */}
        <Route path="/book" element={<BookPage />} />
        <Route path="/book/:token" element={<BookStatusPage />} />

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
        <Route
          path="/vehicles"
          element={
            <ProtectedRoute>
              <VehiclesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vehicles/new"
          element={
            <ProtectedRoute>
              <NewVehiclePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vehicles/:id"
          element={
            <ProtectedRoute>
              <VehicleDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service"
          element={
            <ProtectedRoute>
              <ServiceDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service/ops"
          element={
            <ProtectedRoute>
              <ServiceOpsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service/appointments"
          element={
            <ProtectedRoute>
              <ServiceAppointmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service/book"
          element={
            <ProtectedRoute>
              <StaffBookPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-orders/new"
          element={
            <ProtectedRoute>
              <NewServiceOrderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-orders/:id"
          element={
            <ProtectedRoute>
              <ServiceOrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-orders/:id/billing"
          element={
            <ProtectedRoute>
              <BillingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-orders/:id/quotation"
          element={
            <ProtectedRoute>
              <QuotationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-orders/:id/bill"
          element={
            <ProtectedRoute>
              <BillPrintPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clock-in"
          element={
            <ProtectedRoute>
              <ClockInPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance"
          element={
            <ProtectedRoute>
              <MyAttendancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/attendance"
          element={
            <ProtectedRoute>
              <TeamAttendancePage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
