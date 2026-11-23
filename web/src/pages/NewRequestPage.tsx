import { useState, type FormEvent } from "react";
import { CATEGORIES, type Category, type NewRequestInput } from "../../../shared/contracts.ts";
import { api, ApiError } from "../api.ts";
import { Alert } from "../components/Feedback.tsx";
import { CATEGORY_LABELS, formatMoney, todayIso } from "../format.ts";
import { navigate } from "../router.ts";

interface FormState {
  title: string;
  category: Category;
  quantity: string;
  unitPrice: string;
  justification: string;
  neededBy: string;
}

const INITIAL: FormState = { title: "", category: "LAPTOP", quantity: "1", unitPrice: "", justification: "", neededBy: "" };

function previewTotal(form: FormState): string {
  const quantity = Number(form.quantity);
  const price = Number(form.unitPrice);
  if (!Number.isInteger(quantity) || quantity < 1 || !/^\d+(\.\d{1,2})?$/.test(form.unitPrice)) return "-";
  return formatMoney(Math.round(price * 100) * quantity);
}

export function NewRequestPage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof FormState) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(null);
    const input: NewRequestInput = {
      title: form.title,
      category: form.category,
      quantity: Number(form.quantity),
      unitPrice: form.unitPrice.trim(),
      justification: form.justification,
      neededBy: form.neededBy,
    };
    try {
      const result = await api.createRequest(input);
      navigate(`/requests/${result.request.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_FAILED") setErrors(error.fieldErrors());
      else setFailure(error instanceof Error ? error.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof FormState) => ({
    id: name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const fieldError = (name: string) =>
    errors[name] ? (
      <p className="field-error" id={`${name}-error`}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="page narrow">
      <a className="back" href="#/requests">
        &larr; All requests
      </a>
      <header className="page-head">
        <div>
          <p className="eyebrow">New request</p>
          <h1>Request equipment</h1>
        </div>
      </header>
      {failure ? <Alert>{failure}</Alert> : null}
      {Object.keys(errors).length > 0 ? <Alert tone="warning">Please correct the highlighted fields.</Alert> : null}

      <form className="card form" onSubmit={onSubmit} noValidate>
        <label htmlFor="title">Title</label>
        <input {...field("title")} maxLength={120} value={form.title} onChange={set("title")} placeholder="e.g. Developer laptop, 14-inch" />
        {fieldError("title")}

        <div className="form-row">
          <div>
            <label htmlFor="category">Category</label>
            <select {...field("category")} value={form.category} onChange={set("category")}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
            {fieldError("category")}
          </div>
          <div>
            <label htmlFor="quantity">Quantity</label>
            <input {...field("quantity")} type="number" min={1} max={100} step={1} value={form.quantity} onChange={set("quantity")} />
            {fieldError("quantity")}
          </div>
          <div>
            <label htmlFor="unitPrice">Unit price (USD)</label>
            <input {...field("unitPrice")} inputMode="decimal" placeholder="249.99" value={form.unitPrice} onChange={set("unitPrice")} />
            {fieldError("unitPrice")}
          </div>
        </div>

        <label htmlFor="neededBy">Needed by</label>
        <input {...field("neededBy")} type="date" min={todayIso()} value={form.neededBy} onChange={set("neededBy")} />
        {fieldError("neededBy")}

        <label htmlFor="justification">Business justification</label>
        <textarea {...field("justification")} rows={4} maxLength={1000} value={form.justification} onChange={set("justification")} />
        <p className="hint">{form.justification.trim().length}/1000 characters, at least 10.</p>
        {fieldError("justification")}

        <div className="form-foot">
          <p>
            Total: <strong>{previewTotal(form)}</strong>
          </p>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </form>
    </div>
  );
}
