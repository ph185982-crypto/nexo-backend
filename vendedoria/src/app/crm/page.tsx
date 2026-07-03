import { redirect } from "next/navigation";

export default function CrmHome() {
  redirect("/crm/conversations");
}
