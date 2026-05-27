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
import { listParts } from './parts'
import { listTechnicians } from './technicians'
import { listPayments } from './payments'
import { listInvoices } from './invoices'
import { listAuditForRow } from './audit'
import {
  createPayoutAndAssign,
  createSchedule,
  deleteSchedule,
  listPayouts,
  listSchedules,
  updateSchedule,
} from './commissions'
import type {
  Attachment,
  Attendance,
  AttendanceCheckOut,
  AttendanceInsert,
  AuditLogEntry,
  Booking,
  BookingInsert,
  Car,
  CarInsert,
  CommissionPayout,
  CommissionPayoutInsert,
  CommissionSchedule,
  CommissionScheduleInsert,
  Customer,
  CustomerInsert,
  Invoice,
  Part,
  Payment,
  Profile,
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
  technicians: ['technicians'] as const,
  payments: ['payments'] as const,
  invoices: ['invoices'] as const,
  attendanceAll: ['attendance', 'all'] as const,
  attendanceMine: (profileId: string) =>
    ['attendance', 'mine', profileId] as const,
  attendanceToday: (profileId: string, workDate: string) =>
    ['attendance', 'today', profileId, workDate] as const,
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
    },
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
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
