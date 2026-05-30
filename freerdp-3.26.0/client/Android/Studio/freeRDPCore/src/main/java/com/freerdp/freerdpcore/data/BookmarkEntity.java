/* Bookmark entity */

package com.freerdp.freerdpcore.data;

import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "bookmarks") public class BookmarkEntity
{
	@PrimaryKey(autoGenerate = true) @ColumnInfo(name = "id") public long id;

	@ColumnInfo(name = "label") public String label = "";

	@ColumnInfo(name = "hostname") public String hostname = "";

	@ColumnInfo(name = "username") public String username = "";

	@ColumnInfo(name = "password") public String password = "";

	@ColumnInfo(name = "domain") public String domain = "";

	@ColumnInfo(name = "port") public int port = 3389;

	@ColumnInfo(name = "colors") public int colors = 32;

	/** FITSCREEN=-2, AUTOMATIC=-1, CUSTOM=0, PREDEFINED=1 */
	@ColumnInfo(name = "resolution") public int resolution = -1;

	@ColumnInfo(name = "width") public int width = 0;

	@ColumnInfo(name = "height") public int height = 0;

	@ColumnInfo(name = "perf_remotefx") public boolean perfRemoteFx = false;

	@ColumnInfo(name = "perf_gfx") public boolean perfGfx = true;

	@ColumnInfo(name = "perf_gfx_h264") public boolean perfGfxH264 = false;

	@ColumnInfo(name = "perf_wallpaper") public boolean perfWallpaper = false;

	@ColumnInfo(name = "perf_theming") public boolean perfTheming = false;

	@ColumnInfo(name = "perf_full_window_drag") public boolean perfFullWindowDrag = false;

	@ColumnInfo(name = "perf_menu_animations") public boolean perfMenuAnimations = false;

	@ColumnInfo(name = "perf_font_smoothing") public boolean perfFontSmoothing = false;

	@ColumnInfo(name = "perf_desktop_composition") public boolean perfDesktopComposition = false;

	@ColumnInfo(name = "screen_3g_colors") public int screen3gColors = 16;

	@ColumnInfo(name = "screen_3g_resolution") public int screen3gResolution = -1;

	@ColumnInfo(name = "screen_3g_width") public int screen3gWidth = 0;

	@ColumnInfo(name = "screen_3g_height") public int screen3gHeight = 0;

	@ColumnInfo(name = "perf_3g_remotefx") public boolean perf3gRemoteFx = false;

	@ColumnInfo(name = "perf_3g_gfx") public boolean perf3gGfx = false;

	@ColumnInfo(name = "perf_3g_gfx_h264") public boolean perf3gGfxH264 = false;

	@ColumnInfo(name = "perf_3g_wallpaper") public boolean perf3gWallpaper = false;

	@ColumnInfo(name = "perf_3g_theming") public boolean perf3gTheming = false;

	@ColumnInfo(name = "perf_3g_full_window_drag") public boolean perf3gFullWindowDrag = false;

	@ColumnInfo(name = "perf_3g_menu_animations") public boolean perf3gMenuAnimations = false;

	@ColumnInfo(name = "perf_3g_font_smoothing") public boolean perf3gFontSmoothing = false;

	@ColumnInfo(name = "perf_3g_desktop_composition")
	public boolean perf3gDesktopComposition = false;

	@ColumnInfo(name = "enable_3g_settings") public boolean enable3gSettings = false;

	@ColumnInfo(name = "enable_gateway_settings") public boolean enableGatewaySettings = false;

	@ColumnInfo(name = "gateway_hostname") public String gatewayHostname = "";

	@ColumnInfo(name = "gateway_port") public int gatewayPort = 443;

	@ColumnInfo(name = "gateway_username") public String gatewayUsername = "";

	@ColumnInfo(name = "gateway_password") public String gatewayPassword = "";

	@ColumnInfo(name = "gateway_domain") public String gatewayDomain = "";

	@ColumnInfo(name = "redirect_sdcard") public boolean redirectSdcard = false;

	/** 0=off, 1=local, 2=remote */
	@ColumnInfo(name = "redirect_sound") public int redirectSound = 0;

	@ColumnInfo(name = "redirect_microphone") public boolean redirectMicrophone = false;

	/** 0=auto, 1=rdp, 2=tls, 3=nla */
	@ColumnInfo(name = "security") public int security = 0;

	@ColumnInfo(name = "remote_program") public String remoteProgram = "";

	@ColumnInfo(name = "work_dir") public String workDir = "";

	@ColumnInfo(name = "console_mode") public boolean consoleMode = false;

	@ColumnInfo(name = "debug_level") public String debugLevel = "INFO";

	@ColumnInfo(name = "async_channel") public boolean asyncChannel = false;

	@ColumnInfo(name = "async_update") public boolean asyncUpdate = false;
}
