// SWL Motors CRM — extract-lou Edge Function.
//
// Reads a Letter of Undertaking (LOU) from the financing bank. Required only
// for loan deals. Lands as 'needs_review': Finance Admin types the agreed loan
// amount on /finance and confirms; recompute_booking_documents then marks the
// booking's lou_status 'verified'. The RM600 handling fee is a known constant
// for SWL but we still capture whatever the form states for the audit trail.

import { makeExtractor, asNum, asStr } from '../_shared/docverify.ts'

const PROMPT = `You are reading a bank "Letter of Undertaking" (LOU) for a car hire-purchase loan. Return ONLY a JSON object (no markdown, no commentary). Use numbers for money (no currency symbol, no commas). Use null if a field is blank or unreadable.
{
  "hirer_name": "",
  "loan_amount": 0,
  "handling_fee": 0,
  "plate_no": ""
}`

const handler = makeExtractor({
  fnName: 'extract-lou',
  docType: 'lou',
  prompt: PROMPT,
  allowedKeys: ['hirer_name', 'loan_amount', 'handling_fee', 'plate_no'],
  buildRow: (e) => ({
    extracted_hirer_name: asStr(e.hirer_name),
    extracted_loan_amount_lou: asNum(e.loan_amount),
    extracted_handling_fee: asNum(e.handling_fee),
    extracted_plate_no_lou: asStr(e.plate_no),
    verification_status: 'needs_review',
  }),
})

Deno.serve(handler)
