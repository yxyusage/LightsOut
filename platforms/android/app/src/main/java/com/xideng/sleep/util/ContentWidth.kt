package com.xideng.sleep.util

import android.view.View
import android.view.ViewGroup

/**
 * 熄灯早睡 · 大屏排版
 *
 * 手机上内容铺满屏宽；平板上如果照搬，正文一行能排 60 多个汉字，读起来非常累。
 * 这里统一给"内容列"加一个最大宽度，超出后在屏幕里居中——这是平板适配里性价比最高的一招。
 *
 * 用法：布局里把内容放进一个 `layout_gravity="center_horizontal"` 的容器，
 * 在 `onResume`/`onCreate` 里调用 [cap]。
 */
object ContentWidth {

    /** 正文列的最大宽度。560dp ≈ 舒适阅读宽度，也刚好能放进 8~11 寸平板的竖屏。 */
    const val DEFAULT_MAX_DP = 560

    fun cap(view: View, maxDp: Int = DEFAULT_MAX_DP) {
        val density = view.resources.displayMetrics.density
        val screenWidth = view.resources.displayMetrics.widthPixels
        val capPx = (maxDp * density).toInt()
        val target = if (screenWidth > capPx) capPx else ViewGroup.LayoutParams.MATCH_PARENT
        val params = view.layoutParams ?: return
        if (params.width != target) {
            params.width = target
            view.layoutParams = params
        }
    }

    /** 屏幕宽度是否足够大，值得当成"平板"来排版。 */
    fun isLargeScreen(view: View, minDp: Int = 600): Boolean =
        view.resources.configuration.smallestScreenWidthDp >= minDp
}
