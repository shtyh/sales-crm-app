// SWL Motors CRM — extract-all-in-one Edge Function.
//
// Reads a Proton "All In One Preparation" form for the document-verification
// flow (DISTINCT from the commission-verify extract-allinone pipeline). The
// presence/absence of the Sales Manager signature drives the initial state:
// no SM signature → the row is rejected outright (and Finance is alerted);
// otherwise it lands as pending for Finance to approve.

import { makeExtractor, asNum, asStr, asBool } from '../_shared/docverify.ts'

const PROMPT = `You are reading a Proton car-sale "All In One Preparation" form. Return ONLY a JSON object (no markdown, no commentary) with these keys. Use numbers for money (no currency symbols, no commas). Use null if a cell is blank or unreadable.
{
  "customer_name": "",
  "sa_name": "",
  "model": "",
  "plate_no": "",
  "otr": 0,
  "pesb_discount": 0,
  "own_discount": 0,
  "insurance": 0,
  "total_otr": 0,
  "loan_amount": 0,
  "down_payment": 0,
  "balance": 0,
  "commission": 0,
  "payment_type": "cash or loan",
  "sm_signature_detected": false
}
For "sm_signature_detected": return true ONLY if there is a visible signature or sign-off in the Sales Manager / SM approval area, otherwise false. For "payment_type": "loan" if there is a loan/hire-purchase amount, else "cash".`

const handler = makeExtractor({
  fnName: 'extract-all-in-one',
  docType: 'all_in_one',
  prompt: PROMPT,
  allowedKeys: [
    'customer_name', 'sa_name', 'model', 'plate_no', 'otr', 'pesb_discount',
    'own_discount', 'insurance', 'total_otr', 'loan_amount', 'down_payment',
    'balance', 'commission', 'payment_type', 'sm_signature_detected',
  ],
  buildRow: (e) => {
    const sm = asBool(e.sm_signature_detected)
    const pt = asStr(e.payment_type)?.toLowerCase()
    const noSig = sm === false
    return {
      extracted_otr: asNum(e.otr),
      extracted_pesb_discount: asNum(e.pesb_discount),
      extracted_own_discount: asNum(e.own_discount),
      extracted_insurance: asNum(e.insurance),
      extracted_total_otr: asNum(e.total_otr),
      extracted_loan_amount: asNum(e.loan_amount),
      extracted_down_payment: asNum(e.down_payment),
      extracted_balance: asNum(e.balance),
      extracted_commission: asNum(e.commission),
      extracted_sa_name: asStr(e.sa_name),
      extracted_customer_name: asStr(e.customer_name),
      extracted_model: asStr(e.model),
      extracted_plate_no: asStr(e.plate_no),
      extracted_sm_signature_detected: sm,
      extracted_payment_type: pt === 'loan' || pt === 'cash' ? pt : null,
      verification_status: noSig ? 'rejected' : 'pending',
      rejection_reason: noSig ? 'No Sales Manager signature detected on the form.' : null,
    }
  },
})

Deno.serve(handler)
