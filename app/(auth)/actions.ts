"use server";

import { ipAddress } from "@vercel/functions";
import { headers } from "next/headers";
import { z } from "zod";

import { createUser, getSystemSettings, getUser } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { verifyRegistrationChallenge } from "@/lib/server/security/turnstile";

import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "disabled"
    | "invalid_data"
    | "verification_failed"
    | "rate_limited";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    // Next's ReadonlyHeaders adapter itself has an internal `headers` field.
    // Passing it directly makes @vercel/functions mistake that plain object
    // for a Request's headers; wrap it explicitly so its get() method is used.
    const requestHeaders = await headers();
    await enforceIpRateLimit(
      ipAddress({ headers: requestHeaders }),
      "register"
    );
    if (!(await getSystemSettings()).registrationEnabled) {
      return { status: "disabled" };
    }
    const validatedData = authFormSchema
      .extend({
        email: z.email().max(64),
        password: z
          .string()
          .min(8)
          .max(72)
          .refine((value) => Buffer.byteLength(value) <= 72),
      })
      .parse({
        email: formData.get("email"),
        password: formData.get("password"),
      });
    const validChallenge = await verifyRegistrationChallenge({
      expectedHost: process.env.AUTH_URL,
      production: process.env.NODE_ENV === "production",
      secret: process.env.GRACE_TURNSTILE_SECRET,
      token: formData.get("cf-turnstile-response"),
    });
    if (!validChallenge) {
      return { status: "verification_failed" };
    }

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }
    if (!(await createUser(validatedData.email, validatedData.password))) {
      return { status: "user_exists" };
    }
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }
    if (error instanceof ChatbotError && error.type === "rate_limit") {
      return { status: "rate_limited" };
    }

    return { status: "failed" };
  }
};
