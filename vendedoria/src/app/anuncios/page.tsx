import { redirect } from "next/navigation";

// /anuncios vive em /crm/anuncios (o middleware só protege /crm/*).
export default function AnunciosRedirect() {
  redirect("/crm/anuncios");
}
