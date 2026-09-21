import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import BatchJobStatusCard from "../components/ui/BatchJobStatusCard";
import BrokenText from "../components/ui/BrokenText";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Chip from "../components/ui/Chip";
import Toggle from "../components/ui/Toggle";
import { deleteAccount } from "../lib/account";
import { supabase } from "../lib/supabase";

const SUPPORT_EMAIL = "support@zipup.com";

function DeleteAccountModal({
  onCancel,
  onConfirm,
  loading,
  error,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
      <Card className="w-full max-w-[360px]">
        <h2 className="text-sm font-bold text-text-dark">
          정말 탈퇴하시겠어요?
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-text-gray">
          <BrokenText text="탈퇴하면 계정 정보가 모두 삭제되며 복구할 수 없어요." />
        </p>
        {error && (
          <p className="mt-2 text-xs font-medium text-danger">{error}</p>
        )}
        <div className="mt-4 flex gap-2">
          <div className="flex-1">
            <Button
              variant="outline"
              type="button"
              onClick={onCancel}
              disabled={loading}
            >
              취소
            </Button>
          </div>
          <div className="flex-1">
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="h-12 w-full rounded-btn bg-danger text-sm font-bold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {loading ? "삭제 중..." : "탈퇴하기"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(true);

  const [riskAlerts, setRiskAlerts] = useState(true);
  const [marketingAlerts, setMarketingAlerts] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate("/login", { replace: true });
        return;
      }
      setUser(data.user);
      setUserLoading(false);
    });
  }, [navigate]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      await supabase.auth.signOut().catch(() => {});
      navigate("/login", { replace: true });
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "탈퇴 처리 중 오류가 발생했습니다.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (userLoading || !user) {
    return (
      <div className="flex flex-col items-center px-6 pt-24 text-center">
        <p className="text-sm text-text-gray">불러오는 중...</p>
      </div>
    );
  }

  const displayName =
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "사용자";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  return (
    <div className="flex w-full flex-col gap-4 px-5 pt-6 pb-4 lg:mx-auto lg:max-w-[820px] lg:gap-6 lg:px-6 lg:py-10">
      <header className="lg:hidden">
        <h1 className="text-lg font-bold text-primary">프로필</h1>
      </header>

      <div className="hidden lg:block">
        <h1 className="text-2xl font-bold text-text-dark">프로필</h1>
      </div>

      {/* 프로필 카드 */}
      <Card className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-bg text-2xl font-bold text-primary-dark">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-text-dark">
              {displayName}
            </h2>
            <Chip tone="success">안심 회원</Chip>
          </div>
          <p className="mt-1 truncate text-xs text-text-gray">{user.email}</p>
        </div>
      </Card>

      {/* 알림 설정 */}
      <Card>
        <h2 className="text-sm font-bold text-text-dark">알림 설정</h2>
        <div className="mt-1 flex flex-col divide-y divide-border">
          <Toggle
            label="위험 매물 알림"
            description="관심 지역의 위험도가 변경되면 알려드려요"
            checked={riskAlerts}
            onChange={setRiskAlerts}
          />
          <Toggle
            label="마케팅 정보 수신"
            description="이벤트 및 혜택 소식을 받아볼게요"
            checked={marketingAlerts}
            onChange={setMarketingAlerts}
          />
        </div>
        <p className="mt-2 text-[10px] text-text-lightgray">
          <BrokenText text="알림 발송 기능은 준비 중이에요. 설정은 저장되지 않아요." />
        </p>
      </Card>

      {/* 배치 작업 상태 */}
      <BatchJobStatusCard />

      {/* 정책 / 고객센터 */}
      <Card className="p-0">
        <Link
          to="/scoring"
          className="flex items-center justify-between px-4 py-3.5 text-sm font-medium text-text-dark"
        >
          위험도 산정 기준
          <span className="text-text-lightgray">›</span>
        </Link>
        <div className="border-t border-border" />
        <Link
          to="/privacy"
          className="flex items-center justify-between px-4 py-3.5 text-sm font-medium text-text-dark"
        >
          개인정보 처리방침
          <span className="text-text-lightgray">›</span>
        </Link>
        <div className="border-t border-border" />
        <div className="flex items-center justify-between px-4 py-3.5 text-sm font-medium text-text-dark">
          고객 센터
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-xs font-bold text-primary"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </Card>

      {/* 로그아웃 / 회원탈퇴 */}
      <div className="flex flex-col items-center gap-3 pb-4">
        <Button type="button" onClick={handleLogout}>
          로그아웃
        </Button>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="text-xs font-medium text-text-lightgray underline"
        >
          회원탈퇴
        </button>
      </div>

      {showDeleteModal && (
        <DeleteAccountModal
          onCancel={() => {
            setShowDeleteModal(false);
            setDeleteError(null);
          }}
          onConfirm={handleDeleteAccount}
          loading={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}
