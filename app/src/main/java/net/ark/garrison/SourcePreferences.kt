package net.ark.garrison

import android.content.Context
import org.json.JSONArray

class SourcePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("source-selection-v1", Context.MODE_PRIVATE)

    fun customSources(): List<WebSource> {
        val json = runCatching { JSONArray(prefs.getString(KEY_CUSTOM, "[]")) }.getOrNull() ?: JSONArray()
        return buildList {
            for (index in 0 until json.length()) {
                val url = json.optString(index)
                runCatching { SourceRegistry.custom(url) }
                    .getOrNull()
                    ?.takeIf { !it.builtIn }
                    ?.let(::add)
            }
        }.distinctBy { it.id }
    }

    fun sources(): List<WebSource> = SourceRegistry.builtIns + customSources()

    fun addCustom(source: WebSource) {
        require(!source.builtIn)
        val urls = (customSources().map { it.baseUrl } + source.baseUrl).distinct()
        prefs.edit().putString(KEY_CUSTOM, JSONArray(urls).toString()).apply()
    }

    fun removeCustom(source: WebSource) {
        if (source.builtIn) return
        prefs.edit().putString(KEY_CUSTOM, JSONArray(customSources().filterNot { it.id == source.id }.map { it.baseUrl }).toString()).apply()
        if (selectedId() == source.id) setSelected(SourceRegistry.builtIns.first().id)
    }

    fun hasSelectedSource(): Boolean = prefs.contains(KEY_SELECTED)

    fun selectedId(): String? = prefs.getString(KEY_SELECTED, null)

    fun setSelected(id: String) {
        prefs.edit().putString(KEY_SELECTED, id).apply()
    }

    fun selectedSource(): WebSource? {
        if (!hasSelectedSource()) return null
        return sources().firstOrNull { it.id == selectedId() } ?: SourceRegistry.builtIns.first()
    }

    fun cachedManifestHash(sourceId: String): String? = prefs.getString(manifestKey(sourceId), null)

    fun setCachedManifestHash(sourceId: String, hash: String) {
        prefs.edit().putString(manifestKey(sourceId), hash).apply()
    }

    fun cacheStatus(sourceId: String): String? = prefs.getString(statusKey(sourceId), null)

    fun setCacheStatus(sourceId: String, status: String) {
        prefs.edit().putString(statusKey(sourceId), status).apply()
    }

    fun clearCacheMetadata(sourceId: String) {
        prefs.edit()
            .remove(manifestKey(sourceId))
            .remove(statusKey(sourceId))
            .apply()
    }

    private fun manifestKey(sourceId: String) = "assets-manifest-$sourceId"
    private fun statusKey(sourceId: String) = "assets-status-$sourceId"

    private companion object {
        const val KEY_CUSTOM = "custom-sources"
        const val KEY_SELECTED = "selected-source"
    }
}
