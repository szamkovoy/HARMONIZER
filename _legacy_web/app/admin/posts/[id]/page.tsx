"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { PostEditor, type AdminComment, type AdminPost } from "../_components/PostEditor";

export default function AdminPostPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ post: AdminPost; comments: AdminComment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    adminFetch<{ post: AdminPost; comments: AdminComment[] }>(`/api/admin/posts/${id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить публикацию"));
  }, [id]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загружаю…
      </p>
    );
  }
  return <PostEditor post={data.post} comments={data.comments} />;
}
