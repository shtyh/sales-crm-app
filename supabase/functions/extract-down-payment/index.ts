// SWL Motors CRM — extract-down-payment Edge Function.
//
// Reads a customer down-payment receipt / bank-in slip. Each receipt is a row;
// recompute_booking_documents sums extracted_payment_amount across all of a
// booking's down-payment rows and marks the down payment complete once the
// total reaches (total OTR − loan) within RM1. These rows are auto-accepted
// ('approved') — they're evidence to be summed, not a human-gated decision.

import { makeExtractor, asNum, asStr, asDate } from '../_shared/docverify.ts'

const PROMPT = `You are reading a payment receipt or bank-in slip for a car down payment. Return ONLY a JSON object (no markdown, no commentary). Use a number for the amount (no currency symbol, no commas). Use null if a field is blank or unreadable.
{
  "payment_amount": 0,
  "payment_date": "YYYY-MM-DD",
  "payer_name": "",
  "plate_no": ""
}`

const handler = makeExtractor({
  fnName: 'extract-down-payment',
  docType: 'down_payment',
  prompt: PROMPT,
  allowedKeys: ['payment_amount', 'payment_date', 'payer_name', 'plate_no'],
  buildRow: (e) => ({
    extracted_payment_amount: asNum(e.payment_amount),
    extracted_payment_date: asDate(e.payment_date),
    extracted_payer_name: asStr(e.payer_name),
    extracted_plate_no: asStr(e.plate_no),
    verification_status: 'approved',
  }),
})

Deno.serve(handler)
