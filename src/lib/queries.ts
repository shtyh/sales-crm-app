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
import { listAttachments } from './attachments'
import { createCar, getCar, listCars, updateCar } from './cars'
import type {
  Attachment,
  Booking,
  BookingInsert,
  Car,
  CarInsert,
  Profile,
} from './types'

// Query keys — centralised so we can invalidate from anywhere without
// having to remember the tuple shape.
export const qk = {
  bookings: ['bookings'] as const,
  booking: (id: string) => ['bookings', id] as const,
  profiles: ['profiles'] as const,
  attachments: (bookingId: string) =>
    ['booking-attachments', bookingId] as const,
  cars: ['cars'] as const,
  car: (id: string) => ['cars', id] as const,
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
