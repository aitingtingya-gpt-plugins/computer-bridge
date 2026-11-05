/** Shared phone layout, including short landscape viewports on touch devices. */
export const compactMedia='(max-width:760px), (pointer:coarse) and (max-width:1024px) and (max-height:500px)';

export const mobileStyles=String.raw`
@media ${compactMedia}{
 body{padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
 body input:not([type=hidden]),body select,body textarea{font-size:16px!important}
 button,summary{min-height:44px;min-width:44px}button{touch-action:manipulation}
 .text-button{display:inline-flex;align-items:center;justify-content:center}.brand{min-height:44px}
 .topbar{height:56px;padding:0 12px}.topbar .top-label{display:none}main{width:100%;margin:20px 0;padding:0 12px;min-width:0}
 .auth-card{width:100%;padding:20px;margin-top:18px}.auth-card button{max-width:100%;white-space:normal}.auth-card button[value=deny]{margin-left:0}
 .auth-details,.auth-card p,.notice,.account-card h3,.update-job,.device-meta,.grant-row{overflow-wrap:anywhere;min-width:0}
 .management-page>.topbar{height:52px;padding:0 12px}.management-page main{padding:0 8px 8px}
 .management-page main>h1{font-size:22px;margin:10px 4px 14px}
 .management-page .account-navigation{margin:0;padding:0 0 6px;min-height:50px;display:block}
 .management-page .account-identity{position:absolute;top:env(safe-area-inset-top,0px);right:max(12px,env(safe-area-inset-right,0px));height:52px;max-width:calc(100% - 195px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));display:flex;align-items:center;gap:6px;min-width:0}
 .management-page .account-identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.management-page .account-identity code{flex-shrink:0}
 .management-page .account-navigation .muted{display:none}.management-page .account-navigation .account-links{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;width:100%}
 .account-links a{display:flex;align-items:center;justify-content:center;min-height:44px;padding:6px 4px;font-size:14px;white-space:nowrap;border-radius:7px}.account-links a:hover{background:var(--soft)}
 .dashboard,.accounts-layout{grid-template-columns:minmax(0,1fr);gap:18px}.device-grid{grid-template-columns:minmax(0,1fr)}
 .device-card,.account-card,.pair-card,.updates-panel{padding:16px}.pair-card{margin-top:0}.device-meta,.device-top,.account-actions,.grant-row{flex-wrap:wrap}
 .account-rename,.account-password form{display:grid;grid-template-columns:minmax(0,1fr);align-items:start}.account-rename button,.account-password button{justify-self:start}
 .account-card .section-heading,.device-actions,.update-heading{flex-wrap:wrap}.grant-row>span{min-width:0}.grant-form{flex-wrap:wrap}.grant-form label{flex-basis:100%}
 .workspace-form button,.apply-access{min-height:44px}.access-toggle label,.update-select{min-height:44px}.update-source{flex-wrap:wrap}.update-source label:first-child{flex-basis:100%}
 .update-job{flex-wrap:wrap}.device-card .chat-device-link,.chat-file{min-height:44px}.device-card .chat-device-link{display:inline-flex;align-items:center}
 dialog{max-height:calc(100dvh - 24px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));overflow:auto;padding:18px;overflow-wrap:anywhere}
 .chat-page dialog{top:calc(var(--chat-visible-top,0px) + max(12px,env(safe-area-inset-top,0px)));bottom:auto;margin:0 auto;max-height:calc(var(--chat-visible-height,100dvh) - 24px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))}
 .chat-dialog-actions{flex-wrap:wrap}.chat-id-copy{gap:8px}.chat-connect-steps{padding-left:20px}
 .chat-approval{padding:12px;max-width:100%}.chat-approval-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:8px}.chat-approval-actions button{padding:8px;font-size:13px;white-space:normal}
 .chat-attachment{max-width:100%;min-width:0}.chat-attachment>span{overflow-wrap:anywhere;min-width:0}.chat-attachment button{flex-shrink:0}
 .chat-message-body{min-width:0;max-width:100%}.chat-message-body pre,.chat-message-body table,.cb-display{overscroll-behavior-x:contain;touch-action:pan-x pan-y}
 .cb-equation:not(.cb-display)>.cb-math-target{display:inline-block;max-width:100%;overflow-x:auto;vertical-align:middle;overscroll-behavior-x:contain}
 .cb-copy{min-height:44px;min-width:44px}.cb-math-source summary{display:inline-flex;align-items:center;min-height:44px;min-width:44px}
 @media(max-height:500px){.management-page>.topbar,.management-page .account-identity{height:44px}.management-page .account-navigation{min-height:44px;padding-bottom:0}}
}
`;
