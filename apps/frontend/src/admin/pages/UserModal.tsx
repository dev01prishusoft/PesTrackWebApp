import { useState, useMemo } from 'react';
import { X, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/button';
import { MultiSelect } from '../components/ui/MultiSelect';
import {
  useCreateUser, useUpdateUser, useResetPassword, useAllSites, useActiveAdminCount,
} from '../api/queries';
import { useToast } from '../../components/Toast';
import type { User } from '../lib/types';

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-input bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40';

const ADMIN_DEACTIVATION_ERROR =
  'At least 2 active admins are required. Promote another user to admin before deactivating this account.';

export function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const editing = !!user;
  // Editing an existing admin: role is locked (admins have access to every site).
  const isEditingAdmin = editing && user?.role === 'admin';
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPw = useResetPassword();
  const toast = useToast();
  const { data: activeAdminCount } = useActiveAdminCount(editing && user?.role === 'admin' && user.is_active);

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState(user?.role ?? 'engineer');
  const isAdminRole = role === 'admin';
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [err, setErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: sites } = useAllSites();
  const [siteIds, setSiteIds] = useState<number[]>(user?.sites?.map(s => s.id) ?? []);
  const siteOptions = useMemo(
    () => (sites ?? []).map((s) => ({ id: s.id, name: s.name })),
    [sites]
  );

  // Password fields for creation
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Password fields for resetting
  const [isResettingPw, setIsResettingPw] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // Helper to check standard password complexity
  const checkPasswordValidity = (pw: string) => {
    return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[\W_]/.test(pw);
  };

  async function save() {
    setErr('');
    const errors: Record<string, string> = {};

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required';
    }
    if (!editing) {
      if (!username.trim()) {
        errors.username = 'Username is required';
      } else if (/\s/.test(username)) {
        errors.username = 'Username cannot contain spaces';
      } else if (username.trim().length < 3) {
        errors.username = 'Username must be at least 3 characters';
      }
    }
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Must be a valid email address';
    }
    if (!role) {
      errors.role = 'Role is required';
    }

    if (!editing) {
      if (!password) {
        errors.password = 'Initial password is required';
      } else if (!checkPasswordValidity(password)) {
        errors.password = 'Password does not meet standard requirements';
      }
      if (!confirmPassword) {
        errors.confirmPassword = 'Confirm password is required';
      } else if (password !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    }

  // Engineers and client_viewers must be assigned at least one site. Admins
  // are exempt (they have access to every site — the field is hidden).
  if (!isAdminRole && siteIds.length === 0) {
    errors.siteIds = 'At least one site must be assigned';
  }

  if (
    editing
    && user?.role === 'admin'
    && user.is_active
    && !isActive
    && (activeAdminCount ?? 0) < 3
  ) {
    errors.isActive = ADMIN_DEACTIVATION_ERROR;
  }

  if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    try {
      const sitePayload = isAdminRole ? [] : siteIds;
      if (editing) {
        await updateUser.mutateAsync({
          id: user!.id,
          body: { fullName, email, role, isActive, siteIds: sitePayload },
        });
        toast.success('Updated successfully.');
      } else {
        await createUser.mutateAsync({
          username,
          email,
          password,
          fullName,
          role,
          isActive,
          siteIds: sitePayload,
        });
        toast.success('Saved successfully.');
      }
      onClose();
    } catch (e) {
      // Surface conflicts (duplicate username/email/full name) as a single toast
      // — e.g. "Some fields are already in use" — instead of per-field inline text.
      toast.error((e as Error).message);
    }
  }

  async function saveResetPassword() {
    setErr('');
    const errors: Record<string, string> = {};

    if (!newPassword) {
      errors.newPassword = 'New password is required';
    } else if (!checkPasswordValidity(newPassword)) {
      errors.newPassword = 'Password does not meet standard requirements';
    }
    if (!confirmNewPassword) {
      errors.confirmNewPassword = 'Confirm new password is required';
    } else if (newPassword !== confirmNewPassword) {
      errors.confirmNewPassword = 'Passwords do not match';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    try {
      await resetPw.mutateAsync({ id: user!.id, password: newPassword });
      toast.success('Password reset successfully.');
      setIsResettingPw(false);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const cannotDeactivateAdmin =
    isEditingAdmin && user?.is_active && (activeAdminCount ?? 0) < 3;

  function toggleActive() {
    if (isActive && cannotDeactivateAdmin) {
      toast.error(ADMIN_DEACTIVATION_ERROR);
      return;
    }
    setIsActive(!isActive);
    setFieldErrors((prev) => ({ ...prev, isActive: '' }));
  }

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-[620px] max-w-[94vw] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Fixed Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold m-0">{editing ? 'Edit User' : 'New User'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"><X size={18} /></button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {err && <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm mb-4">{err}</div>}

          {/* Grid layout with normal bottom padding since dropdown opens upwards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 pb-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Full name <span className="text-destructive">*</span></label>
              <input className={inputCls} maxLength={255} value={fullName} onChange={(e) => { setFullName(e.target.value); setFieldErrors(prev => ({ ...prev, fullName: '' })); }} placeholder="Full Name" autoComplete="off" name="new-fullname" />
              {fieldErrors.fullName && <p className="text-destructive text-xs mt-1">{fieldErrors.fullName}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Username {!editing && <span className="text-destructive">*</span>}</label>
              <input
                className={`${inputCls} ${editing ? 'opacity-60 bg-muted cursor-not-allowed' : ''}`}
                maxLength={100}
                value={username}
                onChange={(e) => { if (!editing) { setUsername(e.target.value.replace(/\s/g, '')); setFieldErrors(prev => ({ ...prev, username: '' })); } }}
                placeholder="username"
                disabled={editing}
                autoComplete="off"
                name="new-username"
              />
              {fieldErrors.username && <p className="text-destructive text-xs mt-1">{fieldErrors.username}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Email <span className="text-destructive">*</span></label>
              <input className={inputCls} type="email" maxLength={255} value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: '' })); }} placeholder="email@example.com" autoComplete="off" name="new-email" />
              {fieldErrors.email && <p className="text-destructive text-xs mt-1">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Role <span className="text-destructive">*</span></label>
              <select
                className={`${inputCls} ${isEditingAdmin ? 'opacity-60 bg-muted cursor-not-allowed' : ''}`}
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as User['role'];
                  setRole(nextRole);
                  if (nextRole === 'admin') setSiteIds([]);
                  setFieldErrors((prev) => ({ ...prev, role: '', siteIds: '' }));
                }}
                disabled={isEditingAdmin}
              >
                <option value="admin">Admin</option>
                <option value="engineer">Engineer</option>
                <option value="client_viewer">Client Viewer</option>
              </select>
              {fieldErrors.role && <p className="text-destructive text-xs mt-1">{fieldErrors.role}</p>}
            </div>

            {!editing && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Initial password <span className="text-destructive">*</span></label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className={`${inputCls} pr-10`}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: '' })); }}
                      placeholder="Enter initial password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {fieldErrors.password ? (
                    <p className="text-destructive text-xs mt-1">{fieldErrors.password}</p>
                  ) : (
                    password && !checkPasswordValidity(password) && (
                      <p className="text-[10px] mt-1 text-destructive font-medium leading-tight">
                        Password must be at least 8 characters and contain uppercase, lowercase, numbers, and special characters.
                      </p>
                    )
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Confirm password <span className="text-destructive">*</span></label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className={`${inputCls} pr-10`}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setFieldErrors(prev => ({ ...prev, confirmPassword: '' })); }}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword ? (
                    <p className="text-destructive text-xs mt-1">{fieldErrors.confirmPassword}</p>
                  ) : (
                    confirmPassword && (
                      <p className={`text-xs mt-1 font-medium ${confirmPassword === password ? 'text-emerald-500' : 'text-destructive'}`}>
                        {confirmPassword === password ? '✓ Passwords match' : '✗ Passwords do not match'}
                      </p>
                    )
                  )}
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Status</label>
              <div className="flex items-center justify-between h-[40px] px-3 rounded-lg border border-input bg-card shadow-sm text-sm">
                <span className="text-foreground">{isActive ? 'Active' : 'Inactive'}</span>
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={isActive && !!cannotDeactivateAdmin}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring/40 ${
                    isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                  } ${cannotDeactivateAdmin && isActive ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {fieldErrors.isActive && <p className="text-destructive text-xs mt-1">{fieldErrors.isActive}</p>}
              {cannotDeactivateAdmin && isActive && !fieldErrors.isActive && (
                <p className="text-muted-foreground text-xs mt-1">{ADMIN_DEACTIVATION_ERROR}</p>
              )}
            </div>

            {!isAdminRole && (
            <div className="sm:col-span-2 mt-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-2">Assigned Sites <span className="text-destructive">*</span></label>
              <MultiSelect
                options={siteOptions}
                selectedIds={siteIds}
                onChange={(ids) => { setSiteIds(ids); setFieldErrors(prev => ({ ...prev, siteIds: '' })); }}
                placeholder="Assign sites to user..."
                openDirection="up"
              />
              {fieldErrors.siteIds && <p className="text-destructive text-xs mt-1">{fieldErrors.siteIds}</p>}
            </div>
            )}
          </div>

          {/* Password Reset Sub-panel for Editing mode inside the scrollable area */}
          {editing && isResettingPw && (
            <div className="mt-2 p-4 rounded-xl border border-border bg-muted/30">
              <h4 className="text-sm font-bold mb-3">Reset User Password</h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">New password <span className="text-destructive">*</span></label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      className={`${inputCls} pr-10`}
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setFieldErrors(prev => ({ ...prev, newPassword: '' })); }}
                      placeholder="Enter new password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {fieldErrors.newPassword ? (
                    <p className="text-destructive text-xs mt-1">{fieldErrors.newPassword}</p>
                  ) : (
                    newPassword && !checkPasswordValidity(newPassword) && (
                      <p className="text-[10px] mt-1 text-destructive font-medium leading-tight">
                        Password must be at least 8 characters and contain uppercase, lowercase, numbers, and special characters.
                      </p>
                    )
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Confirm new password <span className="text-destructive">*</span></label>
                  <div className="relative">
                    <input
                      type={showConfirmNewPassword ? 'text' : 'password'}
                      className={`${inputCls} pr-10`}
                      value={confirmNewPassword}
                      onChange={(e) => { setConfirmNewPassword(e.target.value); setFieldErrors(prev => ({ ...prev, confirmNewPassword: '' })); }}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                    >
                      {showConfirmNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {fieldErrors.confirmNewPassword ? (
                    <p className="text-destructive text-xs mt-1">{fieldErrors.confirmNewPassword}</p>
                  ) : (
                    confirmNewPassword && (
                      <p className={`text-xs mt-1 font-medium ${confirmNewPassword === newPassword ? 'text-emerald-500' : 'text-destructive'}`}>
                        {confirmNewPassword === newPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                      </p>
                    )
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 border-t border-border/50 pt-3">
                <Button variant="outline" size="sm" onClick={() => { setIsResettingPw(false); setNewPassword(''); setConfirmNewPassword(''); }}>Cancel</Button>
                <Button size="sm" onClick={saveResetPassword} disabled={resetPw.isPending}>Save Password</Button>
              </div>
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-border bg-muted/10">
          <div>
            {editing && !isResettingPw && (
              <Button variant="outline" size="sm" onClick={() => setIsResettingPw(true)}>
                <KeyRound size={14} className="mr-1" /> Reset Password
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={createUser.isPending || updateUser.isPending}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
