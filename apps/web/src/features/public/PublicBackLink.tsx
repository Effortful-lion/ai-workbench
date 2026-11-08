/**
 * 公开页统一的返回控件：优先回退站内上一页；从外链/书签直接打开、没有站内历史时落到站内首页。
 */
export default function PublicBackLink() {
  return (
    <a
      href="/"
      className="flex-none hover:text-acc"
      aria-label="返回上一页，没有上一页时回到站内首页"
      onClick={(e) => {
        let sameOrigin = false;
        try {
          sameOrigin = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
        } catch {
          // referrer 非法时按无历史处理
        }
        if (sameOrigin) {
          e.preventDefault();
          window.history.back();
        }
      }}
    >
      ← 返回
    </a>
  );
}
