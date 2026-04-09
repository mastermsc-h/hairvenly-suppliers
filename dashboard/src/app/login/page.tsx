"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type LoginState } from "@/lib/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        action={action}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Hairvenly Orders</h1>
          <p className="text-sm text-neutral-500 mt-1">Bitte einloggen</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="identifier" className="text-sm font-medium text-neutral-700">
            E-Mail oder Benutzername
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            required
            autoComplete="username"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-neutral-700">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-800 disabled:opacity-50 transition"
        >
          {pending ? "Anmelden…" : "Anmelden"}
        </button>

        <p className="text-center text-sm text-neutral-500">
          Noch kein Konto?{" "}
          <Link href="/register" className="text-neutral-900 font-medium hover:underline">
            Registrieren
          </Link>
        </p>
      </form>
    </main>
  );
}
