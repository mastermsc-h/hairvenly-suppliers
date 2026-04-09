"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, type RegisterState } from "@/lib/actions/auth";

export default function RegisterPage() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, undefined);

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        action={action}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Konto erstellen</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Nach der Registrierung muss ein Admin deinen Zugang freigeben.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium text-neutral-700">
            Benutzername
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            minLength={3}
            pattern="[a-zA-Z0-9_.\-]+"
            autoComplete="username"
            placeholder="z.B. amanda_hair"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
          <p className="text-[11px] text-neutral-400">Buchstaben, Zahlen, Punkt, Bindestrich, Unterstrich</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="display_name" className="text-sm font-medium text-neutral-700">
            Anzeigename <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="name"
            placeholder="z.B. Amanda Chen"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-neutral-700">
            E-Mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
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
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="text-sm font-medium text-neutral-700">
            Passwort bestätigen
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
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
          {pending ? "Registrieren…" : "Registrieren"}
        </button>

        <p className="text-center text-sm text-neutral-500">
          Schon ein Konto?{" "}
          <Link href="/login" className="text-neutral-900 font-medium hover:underline">
            Einloggen
          </Link>
        </p>
      </form>
    </main>
  );
}
