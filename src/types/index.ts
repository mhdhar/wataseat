export type TripType = 'fishing' | 'diving' | 'cruising' | 'other';
export type TripStatus = 'draft' | 'open' | 'confirmed' | 'cancelled' | 'completed';
export type BookingStatus = 'pending_payment' | 'authorized' | 'confirmed' | 'cancelled' | 'refunded';
export type OnboardingStep = 'start' | 'name' | 'boat_name' | 'license' | 'iban' | 'bank_name' | 'complete';

export interface Captain {
  id: string;
  created_at: string;
  updated_at: string;
  whatsapp_id: string;
  display_name: string;
  boat_name: string | null;
  vessel_image_url: string | null;
  license_number: string | null;
  onboarding_step: OnboardingStep;
  is_active: boolean;
  stripe_account_id: string | null;
  stripe_onboarding_url: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  total_trips: number;
  total_revenue_aed: number;
  bank_name: string | null;
  is_suspended: boolean;
}

export interface WhatsAppGroup {
  id: string;
  created_at: string;
  group_id: string;
  group_name: string | null;
  captain_id: string;
  is_active: boolean;
  added_at: string;
}

export interface Trip {
  id: string;
  created_at: string;
  updated_at: string;
  captain_id: string;
  group_id: string;
  trip_type: TripType;
  title: string;
  description: string | null;
  departure_at: string;
  duration_hours: number | null;
  meeting_point: string | null;
  location_url: string | null;
  max_seats: number;
  threshold: number;
  price_per_person_aed: number;
  status: TripStatus;
  announcement_message_id: string | null;
  threshold_check_sent_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface Booking {
  id: string;
  created_at: string;
  updated_at: string;
  trip_id: string;
  captain_id: string;
  guest_whatsapp_id: string;
  guest_name: string | null;
  seat_number: number | null;
  num_seats: number;
  price_per_seat_aed: number;
  total_amount_aed: number;
  platform_fee_aed: number | null;
  captain_payout_aed: number | null;
  status: BookingStatus;
  payment_link: string | null;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_link_sent_at: string | null;
  authorized_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface TripSeatOccupancy {
  reserved_seats: number;
  authorized_seats: number;
  confirmed_seats: number;
  total_occupied_seats: number;
}

export interface StripeIntent {
  id: string;
  created_at: string;
  booking_id: string;
  trip_id: string;
  captain_id: string;
  payment_intent_id: string;
  stripe_customer_id: string | null;
  amount_aed: number;
  currency: string;
  is_current: boolean;
  stripe_status: string;
  captured_at: string | null;
  cancelled_at: string | null;
  reauth_count: number;
  application_fee_amount: number | null;
  transfer_amount: number | null;
}

export interface ReauthJob {
  id: string;
  created_at: string;
  booking_id: string;
  scheduled_for: string;
  executed_at: string | null;
  is_complete: boolean;
  attempt_count: number;
  qstash_message_id: string | null;
}

export interface NotificationLog {
  id: string;
  created_at: string;
  recipient_wa_id: string;
  message_type: string;
  template_name: string | null;
  direction: string;
  trip_id: string | null;
  booking_id: string | null;
  captain_id: string | null;
  meta_message_id: string | null;
  status: string;
  error_message: string | null;
}

export interface CreateTripInput {
  captain_id: string;
  group_id: string;
  trip_type: TripType;
  title: string;
  description?: string;
  departure_at: string;
  duration_hours?: number;
  meeting_point?: string;
  location_url?: string;
  max_seats: number;
  threshold: number;
  price_per_person_aed: number;
}

export interface CreateBookingInput {
  trip_id: string;
  captain_id: string;
  guest_whatsapp_id: string;
  guest_name?: string;
  num_seats: number;
  price_per_seat_aed: number;
  total_amount_aed: number;
}

export class WataSeatError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number = 500,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WataSeatError';
  }
}

// Wizard state for trip creation (stored in Redis)
export interface TripWizardState {
  step: 'trip_type' | 'date' | 'time' | 'duration' | 'emirate' | 'meeting_point' | 'location_url' | 'max_seats' | 'threshold' | 'price' | 'vessel_image' | 'confirm';
  captain_id: string;
  group_id?: string;
  trip_type?: TripType;
  departure_date?: string;
  departure_time?: string;
  duration_hours?: number;
  emirate?: string;
  meeting_point?: string;
  location_url?: string;
  max_seats?: number;
  threshold?: number;
  price_per_person_aed?: number;
}

// Cancel confirmation state (stored in Redis)
export interface CancelConfirmState {
  trip_id: string;
  trip_title: string;
  booking_count: number;
}

// Edit wizard state (stored in Redis)
export interface EditWizardState {
  step: 'choose_field' | 'new_value' | 'confirm';
  trip_id: string;
  captain_id: string;
  field_to_edit: string | null;
  new_value: any;
  original_value: any;
}

export type PayoutStatus = 'pending' | 'processing' | 'completed';

export interface Payout {
  id: string;
  created_at: string;
  updated_at: string;
  trip_id: string;
  captain_id: string;
  gross_amount: number;
  commission_amount: number;
  payout_amount: number;
  status: PayoutStatus;
  bank_reference: string | null;
  processed_at: string | null;
  whatsapp_notified: boolean;
}

export interface AdminSetting {
  key: string;
  value: string;
  updated_at: string;
}
