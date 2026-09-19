"use client";

import { useState, useTransition } from "react";
import { startFreshAccount } from "@/actions/account";
import { Button } from "@/components/ui/button";

export function FreshAccountForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-2.5">
      <Button
        onClick={() => start(async () => { const r = await startFreshAccount(); if (r && !r.ok) setError(r.message); })}
        loading={busy}
        fullWidth
      >
        Create a new account
      </Button>
      {error ? <p role="alert" className="text-caption font-medium text-danger">{error}</p> : null}
    </div>
  );
}
