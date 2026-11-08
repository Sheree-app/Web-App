"use client";

import { Button, Checkbox, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";

const PRIVACY_EMAIL = "privacy@getsheree.com";

export function DeletionRequestForm() {
  const [prepared, setPrepared] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = [
      "Hello Sheree Privacy Team,",
      "",
      "I would like to request permanent deletion of my Sheree account and associated personal data.",
      "",
      `Full name: ${form.get("name")}`,
      `Account email: ${form.get("email")}`,
      `Phone number: ${form.get("phone") || "Not provided"}`,
      `Account type: ${form.get("accountType")}`,
      `Additional detail: ${form.get("detail") || "None"}`,
      "",
      "I understand that account deletion is permanent and that Sheree may retain limited records where legally required.",
    ];
    const subject = encodeURIComponent("Sheree account and data deletion request");
    window.location.href = `mailto:${PRIVACY_EMAIL}?subject=${subject}&body=${encodeURIComponent(lines.join("\n"))}`;
    setPrepared(true);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Input label="Full name" name="name" type="text" autoComplete="name" required />
      <Input label="Account email" name="email" type="email" autoComplete="email" required />
      <Input label="Phone number (optional)" name="phone" type="tel" autoComplete="tel" />
      <Select label="Account type" name="accountType" defaultValue="" required>
        <option value="" disabled>
          Choose your account type
        </option>
        <option>Customer</option>
        <option>Beauty professional</option>
        <option>Not sure</option>
      </Select>
      <Textarea
        label="Anything else we should know? (optional)"
        name="detail"
        rows={4}
        placeholder="For example, a different email previously used on the account"
      />
      <Checkbox
        name="confirm"
        required
        label="I understand that deleting my account is permanent and cannot be undone."
      />
      <Button type="submit" variant="danger">
        Prepare deletion email <ArrowRight aria-hidden className="size-5" />
      </Button>
      {prepared ? (
        <FormSuccess message="Your email app should now be open with the request ready to review and send." />
      ) : null}
      <p className="text-caption text-muted">
        No email app? Write to{" "}
        <a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {PRIVACY_EMAIL}
        </a>{" "}
        from your account email.
      </p>
    </form>
  );
}
