export const getAuthPermissionRefresh = ({ event, userId, previousUserId, loadedUserId, loadingUserId }) => {
  if (!userId || event === 'SIGNED_OUT') return null;
  const identityChanged = userId !== previousUserId;
  const revalidate = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED';
  if (!identityChanged && !revalidate && loadingUserId === userId) return null;
  if (!identityChanged && !revalidate && event !== 'INITIAL_SESSION' && loadedUserId === userId) return null;
  return {
    foreground: identityChanged || loadedUserId !== userId,
    invalidateCache: identityChanged || revalidate,
  };
};
