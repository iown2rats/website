"use client";

import { useState, useTransition } from "react";
import { claimAdminBootstrap } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function BootstrapForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await claimAdminBootstrap({ token });
          if (r && !r.ok) setError(r.message);
        });
      }}
    >
      <Field label="Bootstrap token" hint="The ADMIN_BOOTSTRAP_TOKEN value from the server environment. Paste it exactly." error={error ?? undefined}>
        {(p) => <Input {...p} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} required minLength={32} />}
      </Field>
      <Button type="submit" variant="ocean" loading={pending} fullWidth disabled={token.length < 32}>
        Make my account the administrator
      </Button>
    </form>
  );
}
