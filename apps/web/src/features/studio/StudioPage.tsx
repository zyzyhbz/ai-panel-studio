import { useCallback } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { Skeleton } from "../../components/ui/States";
import { SessionProvider, useSession } from "./SessionProvider";
import { LobbyView } from "./LobbyView";
import { StageView } from "./StageView";

function StudioSkeleton() {
  return (
    <div className="studio-shell" data-shell="live">
      <div className="studio-header h-14 border-b border-line-1 md:h-16" />
      <div className="studio-rail hidden p-2 md:block">
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
      <div className="studio-stage min-h-0 px-4 py-4">
        <div className="mx-auto max-w-[860px] space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

function StudioBody() {
  const { view, loadState } = useSession();
  const navigate = useNavigate();

  const openReplay = useCallback(() => {
    navigate(`/d/${view.discussionId}/replay`);
  }, [navigate, view.discussionId]);

  // The lobby owns generating/ready/failed-before-any-speech.
  const showLobby =
    view.status === "ready" ||
    view.status === "generating" ||
    (view.status === "failed" && view.messages.length === 0);

  if (showLobby) return <LobbyView />;

  if (loadState === "loading" && view.roster.length === 0) {
    return <StudioSkeleton />;
  }

  return (
    <StageView
      onReplay={view.status === "ended" || view.status === "failed" ? openReplay : null}
    />
  );
}

export function StudioPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) return <Navigate to="/" replace />;

  return (
    <SessionProvider discussionId={id}>
      <StudioBody />
    </SessionProvider>
  );
}
