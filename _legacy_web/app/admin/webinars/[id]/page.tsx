"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import {
  WebinarEditor,
  type AdminWebinar,
  type AdminWebinarQuestion,
  type AdminWebinarRegistration,
} from "../_components/WebinarEditor";

type WebinarDetail = {
  webinar: AdminWebinar;
  questions: AdminWebinarQuestion[];
  registrations: AdminWebinarRegistration[];
};

export default function AdminWebinarPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<WebinarDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    adminFetch<WebinarDetail>(`/api/admin/webinars/${id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить вебинар"));
  }, [id]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загружаю…
      </p>
    );
  }
  return <WebinarEditor webinar={data.webinar} questions={data.questions} registrations={data.registrations} />;
}
