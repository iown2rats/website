"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Primary CTA for step forms: disables and shows a spinner while the action is pending (no duplicate submits). */
export function SubmitButton({ children, disabled, ...rest }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} disabled={disabled} {...rest}>
      {children}
    </Button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-body-sm font-semibold text-danger">
      {message}
    </p>
  );
}
