// React Query hooks for everything we read from / write to Supabase.
// Pages should import these instead of calling the raw fetchers directly,
// so navigating away and back doesn't re-trigger the network round-trip.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBooking,
  deleteBooking,
  getBooking,
  listBookings,
  updateBooking,
} from './bookings'
import { listProfiles, updateProfile } from './profiles'
import { listAllAttachments, listAttachments } from './attachments'
import {
  checkIn,
  checkOut,
  getMyToday,
  listAllAttendance,
  listMyAttendance,
  lunchIn,
  lunchOut,
} from './attendance'
import { createCar, deleteCar, getCar, listCars, updateCar } from './cars'
import {
  deleteCustomer,
  getCustomer,
  getCustomerByNric,
  listCustomers,
  updateCustomer,
  upsertCustomerByNric,
} from './customers'
import {
  createVehicle,
  getVehicle,
  listServiceOrdersByVehicle,
  listVehicles,
  updateVehicle,
} from './vehicles'
import {
  createServiceOrder,
  deleteServiceOrder,
  getServiceOrder,
  listServiceOrders,
  updateServiceOrder,
} from './serviceOrders'
import {
  createServiceOrderItem,
  deleteServiceOrderItem,
  listServiceOrderItems,
  updateServiceOrderItem,
} from './serviceOrderItems'
import {
  cancelAppointment,
  confirmAppointment,
  getAppointmentByToken,
  getAvailableSlots,
  listAppointments,
  rejectAppointment,
  submitAppointment,
} from './serviceAppointments'
import {
  PARTS_PAGE_SIZE,
  fetchStockIssued,
  getPartsStats,
  listParts,
  searchParts,
  updatePart,
  type PartPatch,
  type PartsStats,
} from './parts'
import { listTechnicians } from './technicians'
import { listPayments } from './payments'
import { listInvoices } from './invoices'
import {
  listAuditForBooking,
  listAuditForRow,
  listAuditForTable,
} from './audit'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications'
import {
  createPayoutAndAssign,
  createSchedule,
  deleteSchedule,
  listPayouts,
  listSchedules,
  updateSchedule,
} from './commissions'
import {
  createVerification,
  extractAllInOne,
  listVerifications,
  rematchVerification,
  uploadAllInOneImage,
  type CreateVerificationInput,
} from './commissionVerifications'
import {
  extractAttachment,
  listReconciliations,
  listStatements,
  runReconcile,
  uploadAndExtractStatement,
} from './reconciliation'
import {
  createStockReceipt,
  createSupplier,
  findPartByCodeExact,
  listReceiptItems,
  listStockReceipts,
  listSuppliers,
  searchPartsForCode,
  type NewSupplier,
} from './stockReceive'
import {
  createVehicleType,
  listVehicleTypes,
  type NewVehicleType,
} from './vehicleTypes'
import {
  createServiceCustomer,
  listServiceCustomers,
  type NewServiceCustomer,
} from './serviceCustomers'
import type {
  Attachment,
  Attendance,
  AttendanceCheckOut,
  AttendanceInsert,
  AttendanceLunchIn,
  AttendanceLunchOut,
  AuditLogEntry,
  Booking,
  BookingInsert,
  Car,
  CarInsert,
  CommissionPayout,
  CommissionPayoutInsert,
  CommissionSchedule,
  CommissionScheduleInsert,
  BankStatement,
  BookingReconciliationRow,
  CommissionVerification,
  CommissionVerificationRow,
  NewStockReceipt,
  StockReceipt,
  StockReceiptRow,
  ServiceCustomer,
  ServiceCustomerWithCounts,
  Supplier,
  VehicleType,
  VehicleTypeWithCount,
  Customer,
  CustomerInsert,
  ExtractedAllInOne,
  Invoice,
  AppNotification,
  Part,
  StockIssuedRow,
  Payment,
  AvailableSlot,
  Profile,
  PublicServiceAppointment,
  ServiceAppointment,
  ServiceAppointmentInput,
  ServiceOrder,
  ServiceOrderInsert,
  ServiceOrderItem,
  ServiceOrderItemInsert,
  ServiceOrderWithJoins,
  Technician,
  Vehicle,
  VehicleInsert,
  VehicleWithCustomer,
} from './types'

// Query keys — centralised so we can invalidate from anywhere without
// having to remember the tuple shape.
export const qk = {
  bookings: ['bookings'] as const,
  booking: (id: string) => ['bookings', id] as const,
  profiles: ['profiles'] as const,
  attachments: (bookingId: string) =>
    ['booking-attachments', bookingId] as const,
  allAttachments: ['booking-attachments', 'all'] as const,
  cars: ['cars'] as const,
  car: (id: string) => ['cars', id] as const,
  audit: (tableName: string, rowId: string) =>
    ['audit', tableName, rowId] as const,
  auditTable: (tableName: string) => ['audit', 'table', tableName] as const,
  auditBooking: (bookingId: string) => ['audit', 'booking', bookingId] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['notifications', 'unread'] as const,
  commissionSchedules: ['commission-schedules'] as const,
  commissionPayouts: ['commission-payouts'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  customerByNric: (nric: string) => ['customers', 'by-nric', nric] as const,
  vehicles: ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  serviceOrdersByVehicle: (vehicleId: string) =>
    ['service-orders', 'by-vehicle', vehicleId] as const,
  serviceOrders: ['service-orders'] as const,
  serviceOrder: (id: string) => ['service-orders', id] as const,
  serviceOrderItems: (orderId: string) =>
    ['service-orders', orderId, 'items'] as const,
  parts: ['parts'] as const,
  partsSearch: (q: string, page: number, cat: string, activeOnly: boolean) =>
    ['parts', 'search', { q, page, cat, activeOnly }] as const,
  technicians: ['technicians'] as const,
  payments: ['payments'] as const,
  invoices: ['invoices'] as const,
  attendanceAll: ['attendance', 'all'] as const,
  attendanceMine: (profileId: string) =>
    ['attendance', 'mine', profileId] as const,
  attendanceToday: (profileId: string, workDate: string) =>
    ['attendance', 'today', profileId, workDate] as const,
  serviceAppointments: ['service-appointments'] as const,
  serviceAppointmentByToken: (token: string) =>
    ['service-appointments', 'by-token', token] as const,
  availableSlots: (date: string) =>
    ['service-appointments', 'available-slots', date] as const,
  commissionVerifications: ['commission-verifications'] as const,
  bankStatements: ['bank-statements'] as const,
  reconciliations: ['reconciliations'] as const,
}

// ---------- Bookings -------------------------------------------------------

export function useBookings() {
  return useQuery<Booking[]>({
    queryKey: qk.bookings,
    queryFn: listBookings,
  })
}

export function useBooking(id: string) {
  return useQuery<Booking | null>({
    queryKey: qk.booking(id),
    queryFn: () => getBooking(id),
    enabled: !!id,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookingInsert) => createBooking(input),
    onSuccess: (created) => {
      qc.setQueryData<Booking>(qk.booking(created.id), created)
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

export function useUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<BookingInsert>
    }) => updateBooking(id, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Booking>(qk.booking(updated.id), updated)
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

export function useDeleteBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBooking(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.booking(id) })
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

// ---------- Profiles -------------------------------------------------------

export function useProfiles(enabled = true) {
  return useQuery<Profile[]>({
    queryKey: qk.profiles,
    queryFn: listProfiles,
    enabled,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Profile, 'full_name' | 'role'>>
    }) => updateProfile(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.profiles })
    },
  })
}

// ---------- Attachments ----------------------------------------------------

export function useAttachments(bookingId: string) {
  return useQuery<Attachment[]>({
    queryKey: qk.attachments(bookingId),
    queryFn: () => listAttachments(bookingId),
    enabled: !!bookingId,
  })
}

/** Every attachment across every booking. Used by the GA dashboard to
 *  flag bookings missing required paperwork. */
export function useAllAttachments(enabled = true) {
  return useQuery<Attachment[]>({
    queryKey: qk.allAttachments,
    queryFn: listAllAttachments,
    enabled,
  })
}

// ---------- Cars (inventory) -----------------------------------------------

export function useCars(enabled = true) {
  return useQuery<Car[]>({
    queryKey: qk.cars,
    queryFn: listCars,
    enabled,
  })
}

export function useCar(id: string) {
  return useQuery<Car | null>({
    queryKey: qk.car(id),
    queryFn: () => getCar(id),
    enabled: !!id,
  })
}

export function useCreateCar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CarInsert) => createCar(input),
    onSuccess: (created) => {
      qc.setQueryData<Car>(qk.car(created.id), created)
      qc.invalidateQueries({ queryKey: qk.cars })
    },
  })
}

export function useUpdateCar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CarInsert> }) =>
      updateCar(id, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Car>(qk.car(updated.id), updated)
      qc.invalidateQueries({ queryKey: qk.cars })
    },
  })
}

/** Hard-delete a car (super_admin only — DB RLS enforces). */
export function useDeleteCar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCar(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.car(id) })
      qc.invalidateQueries({ queryKey: qk.cars })
    },
  })
}

// ---------- Commission schedules -------------------------------------------

export function useCommissionSchedules(enabled = true) {
  return useQuery<CommissionSchedule[]>({
    queryKey: qk.commissionSchedules,
    queryFn: listSchedules,
    enabled,
  })
}

export function useCreateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CommissionScheduleInsert) => createSchedule(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
      qc.invalidateQueries({
        queryKey: qk.auditTable('commission_schedules'),
      })
    },
  })
}

export function useUpdateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<CommissionScheduleInsert>
    }) => updateSchedule(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
      qc.invalidateQueries({
        queryKey: qk.auditTable('commission_schedules'),
      })
    },
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
      qc.invalidateQueries({
        queryKey: qk.auditTable('commission_schedules'),
      })
    },
  })
}

// ---------- Commission payouts ---------------------------------------------

export function useCommissionPayouts(enabled = true) {
  return useQuery<CommissionPayout[]>({
    queryKey: qk.commissionPayouts,
    queryFn: listPayouts,
    enabled,
  })
}

export function useCreatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      input,
      bookingIds,
    }: {
      input: CommissionPayoutInsert
      bookingIds: string[]
    }) => createPayoutAndAssign(input, bookingIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionPayouts })
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

// ---------- Customers ------------------------------------------------------

export function useCustomers(enabled = true) {
  return useQuery<Customer[]>({
    queryKey: qk.customers,
    queryFn: listCustomers,
    enabled,
  })
}

export function useCustomer(id: string | null | undefined) {
  return useQuery<Customer | null>({
    queryKey: qk.customer(id ?? ''),
    queryFn: () => getCustomer(id as string),
    enabled: !!id,
  })
}

/**
 * Look up a customer by NRIC. Used by NewBookingPage to pre-fill the form
 * when the SA types in an NRIC that already exists. NRIC is trimmed before
 * use; an empty string disables the query so React Query doesn't fire for
 * every keystroke.
 */
export function useCustomerByNric(nric: string) {
  const trimmed = nric.trim()
  return useQuery<Customer | null>({
    queryKey: qk.customerByNric(trimmed),
    queryFn: () => getCustomerByNric(trimmed),
    enabled: trimmed.length > 0,
    // Don't refetch every focus — the moment the user navigates back, they
    // probably just want what's already cached.
    staleTime: 30_000,
  })
}

export function useUpsertCustomerByNric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CustomerInsert) => upsertCustomerByNric(input),
    onSuccess: (saved) => {
      qc.setQueryData<Customer>(qk.customer(saved.id), saved)
      qc.setQueryData<Customer>(qk.customerByNric(saved.nric), saved)
      qc.invalidateQueries({ queryKey: qk.customers })
    },
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<CustomerInsert>
    }) => updateCustomer(id, patch),
    onSuccess: (saved) => {
      qc.setQueryData<Customer>(qk.customer(saved.id), saved)
      qc.setQueryData<Customer>(qk.customerByNric(saved.nric), saved)
      qc.invalidateQueries({ queryKey: qk.customers })
      // A customer change might affect how bookings render (customer name on
      // the list), so invalidate that too.
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

/** Hard-delete a customer (super_admin only — DB RLS enforces). */
export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCustomer(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.customer(id) })
      qc.invalidateQueries({ queryKey: qk.customers })
    },
  })
}

// ---------- Vehicles (workshop) -------------------------------------------

export function useVehicles(enabled = true) {
  return useQuery<VehicleWithCustomer[]>({
    queryKey: qk.vehicles,
    queryFn: listVehicles,
    enabled,
  })
}

export function useVehicle(id: string | null | undefined) {
  return useQuery<VehicleWithCustomer | null>({
    queryKey: qk.vehicle(id ?? ''),
    queryFn: () => getVehicle(id as string),
    enabled: !!id,
  })
}

export function useCreateVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: VehicleInsert) => createVehicle(input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: qk.vehicles })
      // Seed the cache so navigating straight to the detail page is instant.
      qc.setQueryData<Vehicle>(qk.vehicle(created.id), created)
    },
  })
}

export function useUpdateVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<VehicleInsert>
    }) => updateVehicle(id, patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: qk.vehicles })
      qc.invalidateQueries({ queryKey: qk.vehicle(vars.id) })
    },
  })
}

/** Service history on a given vehicle. Returns [] until the SO pages exist. */
export function useServiceOrdersByVehicle(vehicleId: string | null | undefined) {
  return useQuery<ServiceOrder[]>({
    queryKey: qk.serviceOrdersByVehicle(vehicleId ?? ''),
    queryFn: () => listServiceOrdersByVehicle(vehicleId as string),
    enabled: !!vehicleId,
  })
}

// ---------- Workshop dashboard (service orders + parts) -------------------

/** Every service order with vehicle/customer/technician joined. 30s
 *  polling so the workshop dashboard updates near-real-time without
 *  paying for Supabase Realtime sockets. */
export function useServiceOrders(enabled = true) {
  return useQuery<ServiceOrderWithJoins[]>({
    queryKey: qk.serviceOrders,
    queryFn: listServiceOrders,
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Active technicians (workshop mechanic roster). */
export function useTechnicians(enabled = true) {
  return useQuery<Technician[]>({
    queryKey: qk.technicians,
    queryFn: listTechnicians,
    enabled,
  })
}

/** Every part. Low-stock filter applied client-side in the dashboard. */
export function useParts(enabled = true) {
  return useQuery<Part[]>({
    queryKey: qk.parts,
    queryFn: listParts,
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Stock Issued List rows for a date range (YYYY-MM-DD, inclusive). */
export function useStockIssued(from: string, to: string, enabled = true) {
  return useQuery<StockIssuedRow[]>({
    queryKey: ['stockIssued', from, to],
    queryFn: () => fetchStockIssued(from, to),
    enabled: enabled && !!from && !!to,
    staleTime: 60_000,
  })
}

/** Every payment receipt visible to the caller. */
export function usePayments(enabled = true) {
  return useQuery<Payment[]>({
    queryKey: qk.payments,
    queryFn: listPayments,
    enabled,
  })
}

/** Every invoice visible to the caller. */
export function useInvoices(enabled = true) {
  return useQuery<Invoice[]>({
    queryKey: qk.invoices,
    queryFn: listInvoices,
    enabled,
  })
}

/** Single service order with joined vehicle / customer / technician. */
export function useServiceOrder(id: string | null | undefined) {
  return useQuery<ServiceOrderWithJoins | null>({
    queryKey: qk.serviceOrder(id ?? ''),
    queryFn: () => getServiceOrder(id as string),
    enabled: !!id,
  })
}

export function useCreateServiceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ServiceOrderInsert) => createServiceOrder(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.serviceOrders })
    },
  })
}

export function useUpdateServiceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<ServiceOrderInsert>
    }) => updateServiceOrder(id, patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: qk.serviceOrders })
      qc.invalidateQueries({ queryKey: qk.serviceOrder(vars.id) })
    },
  })
}

/** Hard-delete a service order (super_admin only — DB RLS enforces). */
export function useDeleteServiceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteServiceOrder(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.serviceOrder(id) })
      qc.invalidateQueries({ queryKey: qk.serviceOrders })
    },
  })
}

/** Items on a single service order. */
export function useServiceOrderItems(orderId: string | null | undefined) {
  return useQuery<ServiceOrderItem[]>({
    queryKey: qk.serviceOrderItems(orderId ?? ''),
    queryFn: () => listServiceOrderItems(orderId as string),
    enabled: !!orderId,
  })
}

export function useCreateServiceOrderItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ServiceOrderItemInsert) =>
      createServiceOrderItem(input),
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: qk.serviceOrderItems(saved.service_order_id),
      })
    },
  })
}

export function useUpdateServiceOrderItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<ServiceOrderItemInsert>
    }) => updateServiceOrderItem(id, patch),
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: qk.serviceOrderItems(saved.service_order_id),
      })
    },
  })
}

export function useDeleteServiceOrderItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, orderId }: { id: string; orderId: string }) =>
      deleteServiceOrderItem(id).then(() => ({ orderId })),
    onSuccess: ({ orderId }) => {
      qc.invalidateQueries({ queryKey: qk.serviceOrderItems(orderId) })
    },
  })
}

// ---------- Audit log ------------------------------------------------------

/**
 * Recent audit entries for a specific row. `enabled` should usually be the
 * caller's `isSuperAdmin` flag — RLS would return [] for everyone else anyway,
 * but skipping the request avoids the round-trip.
 */
export function useAuditForRow(
  tableName: string,
  rowId: string,
  enabled = true,
) {
  return useQuery<AuditLogEntry[]>({
    queryKey: qk.audit(tableName, rowId),
    queryFn: () => listAuditForRow(tableName, rowId),
    enabled: enabled && !!rowId,
    // Audit data isn't latency-critical; keep it fresh for a minute so we
    // refresh after navigating back from making changes.
    staleTime: 60_000,
  })
}

/**
 * A booking's audit timeline — its own field changes + document upload/removal
 * events. `enabled` should usually be the caller's `isSuperAdmin` flag.
 */
export function useAuditForBooking(bookingId: string, enabled = true) {
  return useQuery<AuditLogEntry[]>({
    queryKey: qk.auditBooking(bookingId),
    queryFn: () => listAuditForBooking(bookingId),
    enabled: enabled && !!bookingId,
    staleTime: 60_000,
  })
}

/**
 * Recent audit entries for a whole table (any row) — table-level change log.
 * `enabled` should usually be the caller's `isSuperAdmin` flag.
 */
export function useAuditForTable(
  tableName: string,
  enabled = true,
  limit = 50,
) {
  return useQuery<AuditLogEntry[]>({
    queryKey: qk.auditTable(tableName),
    queryFn: () => listAuditForTable(tableName, limit),
    enabled,
    staleTime: 60_000,
  })
}

// ---------- Notifications ----------------------------------------------------

/** The caller's notifications (RLS: own + super_admin all), newest first. */
export function useNotifications(limit = 50, enabled = true) {
  return useQuery<AppNotification[]>({
    queryKey: qk.notifications,
    queryFn: () => listNotifications(limit),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Unread count for the bell badge — polled so it stays fresh across tabs. */
export function useUnreadCount(enabled = true) {
  return useQuery<number>({
    queryKey: qk.unreadCount,
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications })
      qc.invalidateQueries({ queryKey: qk.unreadCount })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications })
      qc.invalidateQueries({ queryKey: qk.unreadCount })
    },
  })
}

// ---------- Attendance (clock in / out) ------------------------------------

/** Every attendance row visible (RLS: own + admins see all). */
export function useAllAttendance(enabled = true) {
  return useQuery<Attendance[]>({
    queryKey: qk.attendanceAll,
    queryFn: listAllAttendance,
    enabled,
  })
}

/** This profile's own attendance history. */
export function useMyAttendance(profileId: string | null | undefined) {
  return useQuery<Attendance[]>({
    queryKey: qk.attendanceMine(profileId ?? ''),
    queryFn: () => listMyAttendance(profileId as string),
    enabled: !!profileId,
  })
}

/** Today's attendance row for this profile (Asia/KL date). null if not yet. */
export function useMyToday(
  profileId: string | null | undefined,
  workDate: string,
) {
  return useQuery<Attendance | null>({
    queryKey: qk.attendanceToday(profileId ?? '', workDate),
    queryFn: () => getMyToday(profileId as string, workDate),
    enabled: !!profileId,
    refetchOnWindowFocus: true,
  })
}

export function useCheckIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AttendanceInsert) => checkIn(input),
    onSuccess: (row) => {
      qc.setQueryData<Attendance>(
        qk.attendanceToday(row.profile_id, row.work_date),
        row,
      )
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useCheckOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AttendanceCheckOut }) =>
      checkOut(id, patch),
    onSuccess: (row) => {
      qc.setQueryData<Attendance>(
        qk.attendanceToday(row.profile_id, row.work_date),
        row,
      )
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useLunchOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AttendanceLunchOut }) =>
      lunchOut(id, patch),
    onSuccess: (row) => {
      qc.setQueryData<Attendance>(
        qk.attendanceToday(row.profile_id, row.work_date),
        row,
      )
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

export function useLunchIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AttendanceLunchIn }) =>
      lunchIn(id, patch),
    onSuccess: (row) => {
      qc.setQueryData<Attendance>(
        qk.attendanceToday(row.profile_id, row.work_date),
        row,
      )
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
}

// ---------- Service appointments (customer-facing booking) ----------------

/** Submit a new appointment. Works from anon (public /book) and from
 *  signed-in staff (the staff form fills the same fields). */
export function useSubmitAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ServiceAppointmentInput) => submitAppointment(input),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: qk.availableSlots(input.preferred_date) })
      qc.invalidateQueries({ queryKey: qk.serviceAppointments })
    },
  })
}

/** Open slots for a given date — powers the booking form's slot picker.
 *  Anon + authenticated callable, refetches on window focus so a tab
 *  left open doesn't try to book a now-full slot. */
export function useAvailableSlots(date: string | null | undefined) {
  return useQuery<AvailableSlot[]>({
    queryKey: qk.availableSlots(date ?? ''),
    queryFn: () => getAvailableSlots(date as string),
    enabled: !!date,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  })
}

/** Public read-back for /book/:token. No auth required. */
export function useAppointmentByToken(token: string | null | undefined) {
  return useQuery<PublicServiceAppointment | null>({
    queryKey: qk.serviceAppointmentByToken(token ?? ''),
    queryFn: () => getAppointmentByToken(token as string),
    enabled: !!token,
    refetchOnWindowFocus: true,
  })
}

/** Staff queue at /service/appointments. Workshop SM / SA / super_admin
 *  see all rows; store_keeper + mechanic also read (no write). */
export function useAppointments(enabled = true) {
  return useQuery<ServiceAppointment[]>({
    queryKey: qk.serviceAppointments,
    queryFn: listAppointments,
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useConfirmAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => confirmAppointment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.serviceAppointments })
      qc.invalidateQueries({ queryKey: ['service-appointments'] })
    },
  })
}

export function useRejectAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectAppointment(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.serviceAppointments })
      qc.invalidateQueries({ queryKey: ['service-appointments'] })
    },
  })
}

export function useCancelAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.serviceAppointments })
      qc.invalidateQueries({ queryKey: ['service-appointments'] })
    },
  })
}

// ---------- Commission verifications --------------------------------------

export function useCommissionVerifications(enabled = true) {
  return useQuery<CommissionVerificationRow[]>({
    queryKey: qk.commissionVerifications,
    queryFn: listVerifications,
    enabled,
  })
}

/** Two-stage mutation:
 *   1. Upload the chosen image to Storage as the signed-in user.
 *   2. Ask the Edge Function to extract.
 *  Returns both so the page can preview before the user saves. */
export function useUploadAndExtract() {
  return useMutation({
    mutationFn: async ({
      userId,
      file,
    }: {
      userId: string
      file: File
    }): Promise<{ file_path: string; extracted: ExtractedAllInOne }> => {
      const { file_path } = await uploadAllInOneImage(userId, file)
      const extracted = await extractAllInOne(file_path)
      return { file_path, extracted }
    },
  })
}

export function useCreateCommissionVerification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateVerificationInput) => createVerification(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionVerifications })
    },
  })
}

export function useRematchVerification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rematchVerification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionVerifications })
    },
  })
}

// Re-export the type so the page can import everything from queries.ts and
// not have to know about the lower-level module.
export type { CommissionVerification }

// ---------- Parts inventory: search + edit -------------------------------

export { PARTS_PAGE_SIZE }
export type { PartPatch, PartsStats }

export function usePartsStats(enabled = true) {
  return useQuery<PartsStats>({
    queryKey: ['parts', 'stats'],
    queryFn: getPartsStats,
    enabled,
    staleTime: 30_000,
  })
}

export function usePartsSearch(params: {
  q: string
  page: number
  category?: 'OIL' | 'PRT' | ''
  activeOnly?: boolean
}) {
  const cat = params.category ?? ''
  const activeOnly = params.activeOnly ?? false
  return useQuery({
    queryKey: qk.partsSearch(params.q, params.page, cat, activeOnly),
    queryFn: () =>
      searchParts({
        q: params.q,
        page: params.page,
        category: params.category,
        activeOnly: params.activeOnly,
      }),
    // 80k rows table — keep results around so paginating back doesn't refetch.
    staleTime: 30_000,
  })
}

export function useUpdatePart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PartPatch }) =>
      updatePart(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.parts })
      qc.invalidateQueries({ queryKey: ['parts', 'search'] })
      qc.invalidateQueries({ queryKey: ['parts', 'stats'] })
    },
  })
}

// ---------- Stock Receive -------------------------------------------------

export function useSuppliers(enabled = true) {
  return useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: listSuppliers,
    enabled,
    staleTime: 5 * 60 * 1000, // suppliers change rarely
  })
}

export function useCreateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewSupplier) => createSupplier(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })
}

// ---------- Vehicle Types -------------------------------------------------

export function useVehicleTypes(enabled = true) {
  return useQuery<VehicleTypeWithCount[]>({
    queryKey: ['vehicle-types'],
    queryFn: listVehicleTypes,
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewVehicleType) => createVehicleType(input),
    onSuccess: (created: VehicleType) => {
      qc.invalidateQueries({ queryKey: ['vehicle-types'] })
      return created
    },
  })
}

// ---------- Service customers ---------------------------------------------

export function useServiceCustomers(enabled = true) {
  return useQuery<ServiceCustomerWithCounts[]>({
    queryKey: ['service-customers'],
    queryFn: listServiceCustomers,
    enabled,
    staleTime: 60_000,
  })
}

export function useCreateServiceCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewServiceCustomer) => createServiceCustomer(input),
    onSuccess: (created: ServiceCustomer) => {
      qc.invalidateQueries({ queryKey: ['service-customers'] })
      return created
    },
  })
}

export function useStockReceipts(limit = 20) {
  return useQuery<StockReceiptRow[]>({
    queryKey: ['stock-receipts', limit],
    queryFn: () => listStockReceipts(limit),
  })
}

export function useReceiptItems(receiptId: string | null) {
  return useQuery({
    queryKey: ['stock-receipts', 'items', receiptId],
    queryFn: () => (receiptId ? listReceiptItems(receiptId) : Promise.resolve([])),
    enabled: !!receiptId,
  })
}

/** Triggered on Enter / blur on the part_no entry input. */
export function useLookupPartByCode() {
  return useMutation({
    mutationFn: (code: string) => findPartByCodeExact(code),
  })
}

export function usePartCodeAutocomplete(prefix: string) {
  return useQuery({
    queryKey: ['parts', 'autocomplete', prefix],
    queryFn: () => searchPartsForCode(prefix),
    enabled: prefix.trim().length >= 2,
    staleTime: 30_000,
  })
}

export function useCreateStockReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: NewStockReceipt
      createdBy: string
    }) => createStockReceipt(input, createdBy),
    onSuccess: (created: StockReceipt) => {
      qc.invalidateQueries({ queryKey: ['stock-receipts'] })
      qc.invalidateQueries({ queryKey: qk.parts })
      qc.invalidateQueries({ queryKey: ['parts', 'stats'] })
      qc.invalidateQueries({ queryKey: ['parts', 'search'] })
      // Invalidating ['parts','autocomplete'] is overkill — the autocomplete
      // query refetches on next focus naturally.
      return created
    },
  })
}

// ---------- Reconciliation ------------------------------------------------

export function useBankStatements(enabled = true) {
  return useQuery<BankStatement[]>({
    queryKey: qk.bankStatements,
    queryFn: listStatements,
    enabled,
  })
}

export function useUploadStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, file }: { userId: string; file: File }) =>
      uploadAndExtractStatement(userId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.bankStatements })
      qc.invalidateQueries({ queryKey: qk.reconciliations })
    },
  })
}

export function useReconciliations(enabled = true) {
  return useQuery<BookingReconciliationRow[]>({
    queryKey: qk.reconciliations,
    queryFn: listReconciliations,
    enabled,
  })
}

export function useRunReconcile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bookingId: string) => runReconcile(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reconciliations })
    },
  })
}

export function useExtractAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: string) => extractAttachment(attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reconciliations })
    },
  })
}
