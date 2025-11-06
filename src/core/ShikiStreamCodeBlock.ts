import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComponentPublicInstance,
} from "vue";
import { ShikiCachedRenderer } from "shiki-stream/vue";
import { useShiki } from "./ShikiProvider.js";
import { THEME } from "./highlight/codeTheme.js";
import { ElementNode } from "./segmentText.js";
import { useProxyProps } from "./useProxyProps.js";

const FALLBACK_LANG = "ts";

export const ShikiStreamCodeBlock = defineComponent({
  name: "pre-wrapper",
  props: {
    nodeJSON: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const proxyProps = useProxyProps();
    const { highlighter } = useShiki();
    const computedCodeBlockRenderer = computed(
      () => proxyProps.codeBlockRenderer
    );
    const themeStyle = computed(() => {
      const theme = proxyProps.theme;
      return THEME[theme];
    });

    // 延迟渲染：仅在进入视口后再进行代码高亮
    const isInView = ref(false);
    const observedEl = ref<HTMLElement | null>(null);
    let io: IntersectionObserver | null = null;

    onMounted(() => {
      // 不支持 IntersectionObserver 时直接启用高亮
      if (
        typeof window === "undefined" ||
        !("IntersectionObserver" in window)
      ) {
        isInView.value = true;
        return;
      }
      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry && entry.isIntersecting) {
            isInView.value = true;
            if (observedEl.value) io?.unobserve(observedEl.value);
            io?.disconnect();
            io = null;
          }
        },
        {
          root: null,
          // 预加载阈值，提前一点渲染，避免滚动到视口才闪烁
          rootMargin: "100px 0px",
          threshold: 0.01,
        }
      );
      if (observedEl.value) io.observe(observedEl.value);
    });

    onBeforeUnmount(() => {
      if (observedEl.value && io) io.unobserve(observedEl.value);
      io?.disconnect();
      io = null;
    });

    function getCodeMeta() {
      const node = JSON.parse(props.nodeJSON) as ElementNode;
      const loadedLangs = highlighter!.value!.getLoadedLanguages();
      let language = "";
      let code = "";
      const codeNode = node.children[0];
      if (
        codeNode &&
        codeNode.type === "element" &&
        codeNode.tagName === "code"
      ) {
        const codeTextNode = codeNode.children[0];
        if (codeTextNode.type === "text") {
          const className = codeNode.properties.className as string[];
          if (className) {
            const languageClass = className.find((i) =>
              i.includes("language")
            ) as string;

            let [_, languageName] = languageClass.split("-");
            language = languageName;
          }

          const lastChar = codeTextNode.value[codeTextNode.value.length - 1];
          const codeText = codeTextNode.value.slice(
            0,
            codeTextNode.value.length - (lastChar === "\n" ? 1 : 0)
          );
          const lines = codeText.split("\n");
          const lastLine = lines[lines.length - 1];

          let matchedMarkdownCount = 0;
          if (language === "markdown") {
            lines.forEach((line) => {
              const trimStartLine = line.trimStart();
              if (trimStartLine.startsWith("```")) {
                matchedMarkdownCount++;
              }
            });
            if (
              lastLine &&
              lastLine.trimStart().startsWith("```") &&
              matchedMarkdownCount % 2 === 0
            ) {
              code = codeText;
            }
          } else {
            if (lastLine && lastLine.trimStart().startsWith("`")) {
              code = lines.slice(0, lines.length - 1).join("\n");
            } else {
              code = codeText;
            }
          }
        }
      }
      let highlightLang = language;
      if (!loadedLangs.includes(highlightLang)) highlightLang = FALLBACK_LANG;
      return {
        highlightLang,
        language,
        code,
      };
    }

    return () => {
      if (!highlighter!.value) return null;
      const { highlightLang, language, code: codeChunk } = getCodeMeta();
      if (codeChunk === "") return null;

      // 未进入视口：渲染纯文本以降低开销，并绑定观察
      if (!isInView.value) {
        const plainVnode = h(
          "pre",
          {
            ref: (el: Element | ComponentPublicInstance | null) => {
              observedEl.value = el as HTMLElement | null;
              if (el && io) io.observe(el as HTMLElement);
            },
          },
          [h("code", codeChunk)]
        );

        if (computedCodeBlockRenderer.value) {
          return h(computedCodeBlockRenderer.value, {
            highlightVnode: plainVnode,
            language,
          });
        }
        return plainVnode;
      }

      // 进入视口：渲染高亮
      const highlightVnode = h(ShikiCachedRenderer, {
        highlighter: highlighter!.value,
        code: codeChunk,
        lang: highlightLang,
        theme: "css-variables",
        style: {
          ...themeStyle.value,
          background: "var(--vercel-code-block-background)",
        },
      });

      if (computedCodeBlockRenderer.value) {
        return h(computedCodeBlockRenderer.value, {
          highlightVnode,
          language,
        });
      }
      return highlightVnode;
    };
  },
});
