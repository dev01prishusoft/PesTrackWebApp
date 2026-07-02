import { useState } from 'react';
import { X, KeyRound, Eye, EyeOff, Search, ChevronDown } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  useCreateUser, useUpdateUser, useResetPassword, useAllSites,
} from '../api/queries';
import type { User } from '../lib/types';

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-input bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40';

export function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const editing = !!user;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPw = useResetPassword();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState(user?.role ?? 'engineer');
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [err, setErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: sites } = useAllSites();
  const [siteIds, setSiteIds] = useState<number[]>(user?.sites?.map(s => s.id) ?? []);
  const [siteSearch, setSiteSearch] = useState('');
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);

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
    if (!editing && !username.trim()) {
      errors.username = 'Username is required';
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

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    try {
      if (editing) {
        await updateUser.mutateAsync({
          id: user!.id,
          body: { fullName, email, role, isActive, siteIds },
        });
      } else {
        await createUser.mutateAsync({
          username,
          email,
          password,
          fullName,
          role,
          isActive,
          siteIds,
        });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
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
      alert('Password reset successfully.');
      setIsResettingPw(false);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-[620px] max-w-[94vw] max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
              <input className={inputCls} value={fullName} onChange={(e) => { setFullName(e.target.value); setFieldErrors(prev => ({ ...prev, fullName: '' })); }} placeholder="Full Name" />
              {fieldErrors.fullName && <p className="text-destructive text-xs mt-1">{fieldErrors.fullName}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Username {!editing && <span className="text-destructive">*</span>}</label>
              <input
                className={`${inputCls} ${editing ? 'opacity-60 bg-muted cursor-not-allowed' : ''}`}
                value={username}
                onChange={(e) => { if (!editing) { setUsername(e.target.value); setFieldErrors(prev => ({ ...prev, username: '' })); } }}
                placeholder="username"
                disabled={editing}
              />
              {fieldErrors.username && <p className="text-destructive text-xs mt-1">{fieldErrors.username}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Email <span className="text-destructive">*</span></label>
              <input className={inputCls} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: '' })); }} placeholder="email@example.com" />
              {fieldErrors.email && <p className="text-destructive text-xs mt-1">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Role <span className="text-destructive">*</span></label>
              <select className={inputCls} value={role} onChange={(e) => { setRole(e.target.value as User['role']); setFieldErrors(prev => ({ ...prev, role: '' })); }}>
                <option value="engineer">Engineer</option>
                <option value="client_viewer">Client Viewer</option>
                <option value="admin">Admin</option>
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
                  onClick={() => setIsActive(!isActive)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring/40 ${
                    isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="sm:col-span-2 mt-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-2">Assigned Sites</label>
              <div className="relative">
                <div
                  className="flex items-center justify-between min-h-[40px] px-3 py-1.5 rounded-lg border border-input bg-card shadow-sm text-sm cursor-pointer"
                  onClick={() => setSiteDropdownOpen(!siteDropdownOpen)}
                >
                  <div className="flex flex-wrap gap-1.5 flex-1 mr-2">
                    {siteIds.length === 0 && <span className="text-muted-foreground py-0.5">Select sites...</span>}
                    {sites?.filter(s => siteIds.includes(s.id)).map(site => (
                      <span key={site.id} className="bg-primary/10 text-primary px-2 py-0.5 rounded flex items-center gap-1 text-xs font-medium">
                        {site.name}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSiteIds(siteIds.filter(id => id !== site.id));
                          }}
                          className="hover:text-foreground hover:bg-primary/20 rounded-full p-0.5"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                </div>
                
                {siteDropdownOpen && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-card border border-input rounded-lg shadow-lg overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-input flex items-center gap-2 text-muted-foreground">
                      <Search size={14} className="shrink-0" />
                      <input
                        type="text"
                        className="bg-transparent border-none outline-none w-full text-sm text-foreground placeholder:text-muted-foreground"
                        placeholder="Search sites..."
                        value={siteSearch}
                        onChange={(e) => setSiteSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-[160px] overflow-y-auto p-1">
                      {sites?.filter(s => s.name.toLowerCase().includes(siteSearch.toLowerCase())).map(site => (
                        <label key={site.id} className="flex items-center gap-2 cursor-pointer text-sm text-foreground hover:bg-muted p-2 rounded-md">
                          <input
                            type="checkbox"
                            checked={siteIds.includes(site.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSiteIds([...siteIds, site.id]);
                              else setSiteIds(siteIds.filter(id => id !== site.id));
                            }}
                            className="rounded border-input text-primary focus:ring-primary/40"
                          />
                          {site.name}
                        </label>
                      ))}
                      {sites?.filter(s => s.name.toLowerCase().includes(siteSearch.toLowerCase())).length === 0 && (
                        <div className="text-muted-foreground text-xs p-3 text-center">No sites found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
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
