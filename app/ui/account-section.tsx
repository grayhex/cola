import type * as React from "react";
// One page shell for the account's working sections (#245): «Мои
// велосипеды» and «Мои покатушки» share the title row (name, grey count,
// short helper, primary action on the right) and the toolbar below it.
export default function AccountSectionHead({
  title,
  count,
  helper,
  action,
  toolbar,
  id,
}: {
  title: React.ReactNode;
  count?: number | null;
  helper?: React.ReactNode;
  action?: React.ReactNode;
  toolbar?: React.ReactNode;
  id?: string;
}) {
  return (
    <>
      <header className="account-section-head">
        <div className="account-section-title">
          <div>
            <h2 id={id}>{title}</h2>
            {count != null && (
              <span className="count">{count.toLocaleString("ru-RU")}</span>
            )}
          </div>
          {helper && <p className="help">{helper}</p>}
        </div>
        {action && <div className="account-section-action">{action}</div>}
      </header>
      {toolbar && <div className="account-toolbar">{toolbar}</div>}
    </>
  );
}
