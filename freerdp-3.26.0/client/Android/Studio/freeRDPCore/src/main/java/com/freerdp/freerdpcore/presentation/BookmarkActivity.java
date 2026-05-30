/*
   Bookmark editing activity

   Copyright 2013 Thincast Technologies GmbH, Author: Martin Fleisz

   This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
   If a copy of the MPL was not distributed with this file, You can obtain one at
   http://mozilla.org/MPL/2.0/.
*/

package com.freerdp.freerdpcore.presentation;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.ViewModelProvider;
import androidx.preference.Preference;
import androidx.preference.PreferenceFragmentCompat;
import androidx.preference.PreferenceScreen;

import com.freerdp.freerdpcore.R;
import com.freerdp.freerdpcore.domain.BookmarkBase;
import com.freerdp.freerdpcore.services.LibFreeRDP;

public class BookmarkActivity
    extends AppCompatActivity implements PreferenceFragmentCompat.OnPreferenceStartFragmentCallback
{
	public static final String PARAM_CONNECTION_REFERENCE = "conRef";
	private static final String TAG = "BookmarkActivity";
	private static final String PREFS_NAME = "TEMP";

	private BookmarkViewModel viewModel;

	private final SharedPreferences.OnSharedPreferenceChangeListener prefsListener =
	    (prefs, key) -> viewModel.setSettingsChanged(true);

	@Override protected void onCreate(Bundle savedInstanceState)
	{
		super.onCreate(savedInstanceState);
		setContentView(R.layout.activity_bookmark);

		if (getSupportActionBar() != null)
		{
			getSupportActionBar().setDisplayHomeAsUpEnabled(true);
		}

		viewModel = new ViewModelProvider(this).get(BookmarkViewModel.class);

		viewModel.getSaveCompleteEvent().observe(this, isComplete -> {
			if (isComplete)
				finish();
		});

		viewModel.getBookmarkLiveData().observe(this, bookmark -> {
			// Once data is loaded and written to SharedPreferences, attach the fragment
			if (getSupportFragmentManager().findFragmentByTag("main") == null)
			{
				getSupportFragmentManager()
				    .beginTransaction()
				    .replace(R.id.bookmark_fragment_container, new MainFragment(), "main")
				    .commit();
			}

			getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
			    .registerOnSharedPreferenceChangeListener(prefsListener);
		});

		viewModel.loadBookmark(getIntent().getExtras(),
		                       getSharedPreferences(PREFS_NAME, MODE_PRIVATE));

		getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
			@Override public void handleOnBackPressed()
			{
				if (getSupportFragmentManager().getBackStackEntryCount() > 0)
					getSupportFragmentManager().popBackStack();
				else
					handleRootBackPress();
			}
		});
	}

	@Override protected void onDestroy()
	{
		super.onDestroy();
		getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
		    .unregisterOnSharedPreferenceChangeListener(prefsListener);
	}

	@Override public boolean onSupportNavigateUp()
	{
		getOnBackPressedDispatcher().onBackPressed();
		return true;
	}

	@Override public boolean onCreateOptionsMenu(Menu menu)
	{
		MenuInflater inflater = getMenuInflater();
		inflater.inflate(R.menu.bookmark_menu, menu);
		return true;
	}

	@Override public boolean onOptionsItemSelected(MenuItem item)
	{
		if (item.getItemId() == R.id.action_save)
		{
			SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
			if (!verifySettings(prefs))
			{
				new AlertDialog.Builder(this)
				    .setTitle(R.string.error_bookmark_incomplete_title)
				    .setMessage(R.string.error_bookmark_incomplete)
				    .setPositiveButton(R.string.cancel, (d, w) -> finish())
				    .setNegativeButton(R.string.cont, (d, w) -> d.cancel())
				    .show();
			}
			else
			{
				viewModel.saveBookmark(prefs);
			}
			return true;
		}
		return super.onOptionsItemSelected(item);
	}

	@Override
	public boolean onPreferenceStartFragment(PreferenceFragmentCompat caller, Preference pref)
	{
		PreferenceFragmentCompat fragment =
		    (PreferenceFragmentCompat)getSupportFragmentManager().getFragmentFactory().instantiate(
		        getClassLoader(), pref.getFragment());
		fragment.setArguments(pref.getExtras());

		getSupportFragmentManager()
		    .beginTransaction()
		    .replace(R.id.bookmark_fragment_container, fragment)
		    .addToBackStack(null)
		    .commit();
		return true;
	}

	private void handleRootBackPress()
	{
		SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
		if (!verifySettings(prefs))
		{
			new AlertDialog.Builder(this)
			    .setTitle(R.string.error_bookmark_incomplete_title)
			    .setMessage(R.string.error_bookmark_incomplete)
			    .setPositiveButton(R.string.cancel, (d, w) -> finish())
			    .setNegativeButton(R.string.cont, (d, w) -> d.cancel())
			    .show();
		}
		else if (viewModel.isNewBookmark() || viewModel.isSettingsChanged())
		{
			new AlertDialog.Builder(this)
			    .setTitle(R.string.dlg_title_save_bookmark)
			    .setMessage(R.string.dlg_save_bookmark)
			    .setPositiveButton(R.string.yes, (d, w) -> { viewModel.saveBookmark(prefs); })
			    .setNegativeButton(R.string.no, (d, w) -> finish())
			    .show();
		}
		else
		{
			finish();
		}
	}

	private boolean verifySettings(SharedPreferences prefs)
	{
		return !prefs.getString("bookmark.label", "").isEmpty() &&
		    !prefs.getString("bookmark.hostname", "").isEmpty() &&
		    prefs.getInt("bookmark.port", -1) > 0;
	}

	/** Root screen loaded by the activity on start-up. */

	// -------------------------------------------------------------------------

	public static class MainFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.bookmark_settings, rootKey);

			Preference credPref = findPreference("bookmark.credentials");
			if (credPref != null)
			{
				credPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String username = sp.getString("bookmark.username", "<none>");
					String domain = sp.getString("bookmark.domain", "");

					if (username.isEmpty())
						return "<none>";

					if (!domain.isEmpty())
						return domain + "\\" + username;

					return username;
				});
			}

			Preference screenPref = findPreference("bookmark.screen");
			if (screenPref != null)
			{
				screenPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String res = sp.getString("bookmark.resolution", "800x600");
					if ("automatic".equals(res))
						res = getString(R.string.resolution_automatic);
					else if ("custom".equals(res))
						res = getString(R.string.resolution_custom);
					else if ("fitscreen".equals(res))
						res = getString(R.string.resolution_fit);
					int colors = sp.getInt("bookmark.colors", 16);
					return res + "@" + colors;
				});
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class CredentialsFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.credentials_settings, rootKey);

			Preference passwordPref = findPreference("bookmark.password");
			if (passwordPref != null)
			{
				passwordPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String pwd = sp.getString("bookmark.password", "");
					return pwd.isEmpty() ? getString(R.string.settings_password_empty)
					                     : getString(R.string.settings_password_present);
				});
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class ScreenFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.screen_settings, rootKey);
			applyInitialResolutionState();
			setIntSummaryProvider();
		}

		@Override public void onStart()
		{
			super.onStart();
			Preference res = findPreference("bookmark.resolution");
			if (res != null)
			{
				res.setOnPreferenceChangeListener((pref, newValue) -> {
					boolean custom = "custom".equalsIgnoreCase((String)newValue);
					setEnabled("bookmark.width", custom);
					setEnabled("bookmark.height", custom);
					return true;
				});
			}
		}

		private void applyInitialResolutionState()
		{
			SharedPreferences prefs = getPreferenceManager().getSharedPreferences();
			boolean custom = "custom".equalsIgnoreCase(prefs.getString("bookmark.resolution", ""));
			setEnabled("bookmark.width", custom);
			setEnabled("bookmark.height", custom);
		}

		private void setEnabled(String key, boolean enabled)
		{
			Preference p = findPreference(key);
			if (p != null)
				p.setEnabled(enabled);
		}

		private void setIntSummaryProvider()
		{
			Preference resPref = findPreference("bookmark.resolution");
			if (resPref != null)
			{
				resPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String res = sp.getString("bookmark.resolution", "800x600");
					if ("automatic".equals(res))
						return getString(R.string.resolution_automatic);
					if ("custom".equals(res))
						return getString(R.string.resolution_custom);
					if ("fitscreen".equals(res))
						return getString(R.string.resolution_fit);
					return res;
				});
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class PerformanceFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.performance_flags, rootKey);
			if (!LibFreeRDP.hasH264Support())
			{
				Preference p = findPreference(getString(R.string.preference_key_h264));
				if (p != null)
					p.setEnabled(false);
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class AdvancedFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.advanced_settings, rootKey);

			SharedPreferences prefs = getPreferenceManager().getSharedPreferences();

			// Apply initial enabled states based on saved checkbox values.
			setEnabled("bookmark.gateway_settings",
			           prefs.getBoolean("bookmark.enable_gateway_settings", false));
			boolean has3g = prefs.getBoolean("bookmark.enable_3g_settings", false);
			setEnabled("bookmark.screen_3g", has3g);
			setEnabled("bookmark.performance_3g", has3g);

			// Hide gateway section for non-manual bookmarks.
			BookmarkViewModel vm =
			    new ViewModelProvider(requireActivity()).get(BookmarkViewModel.class);
			BookmarkBase bookmark = vm.getBookmark();
			if (bookmark != null && bookmark.getType() != BookmarkBase.TYPE_MANUAL)
			{
				PreferenceScreen screen = getPreferenceScreen();
				removeIfPresent(screen, "bookmark.enable_gateway_settings");
				removeIfPresent(screen, "bookmark.gateway_settings");
			}

			Preference screenPref = findPreference("bookmark.screen_3g");
			if (screenPref != null)
			{
				screenPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String res = sp.getString("bookmark.resolution_3g", "800x600");
					if ("automatic".equals(res))
						res = getString(R.string.resolution_automatic);
					else if ("custom".equals(res))
						res = getString(R.string.resolution_custom);
					else if ("fitscreen".equals(res))
						res = getString(R.string.resolution_fit);
					int colors = sp.getInt("bookmark.colors_3g", 16);
					return res + "@" + colors;
				});
			}
		}

		@Override public void onStart()
		{
			super.onStart();

			Preference gwCheck = findPreference("bookmark.enable_gateway_settings");
			if (gwCheck != null)
			{
				gwCheck.setOnPreferenceChangeListener((pref, newValue) -> {
					setEnabled("bookmark.gateway_settings", (Boolean)newValue);
					return true;
				});
			}

			Preference g3Check = findPreference("bookmark.enable_3g_settings");
			if (g3Check != null)
			{
				g3Check.setOnPreferenceChangeListener((pref, newValue) -> {
					boolean enabled = (Boolean)newValue;
					setEnabled("bookmark.screen_3g", enabled);
					setEnabled("bookmark.performance_3g", enabled);
					return true;
				});
			}
		}

		private void setEnabled(String key, boolean enabled)
		{
			Preference p = findPreference(key);
			if (p != null)
				p.setEnabled(enabled);
		}

		private void removeIfPresent(PreferenceScreen screen, String key)
		{
			Preference p = findPreference(key);
			if (p != null)
				screen.removePreference(p);
		}
	}

	// -------------------------------------------------------------------------

	public static class ScreenFragment3g extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.screen_settings_3g, rootKey);
			applyInitialResolutionState();
			setIntSummaryProvider();
		}

		@Override public void onStart()
		{
			super.onStart();
			Preference res = findPreference("bookmark.resolution_3g");
			if (res != null)
			{
				res.setOnPreferenceChangeListener((pref, newValue) -> {
					boolean custom = "custom".equalsIgnoreCase((String)newValue);
					setEnabled("bookmark.width_3g", custom);
					setEnabled("bookmark.height_3g", custom);
					return true;
				});
			}
		}

		private void applyInitialResolutionState()
		{
			SharedPreferences prefs = getPreferenceManager().getSharedPreferences();
			boolean custom =
			    "custom".equalsIgnoreCase(prefs.getString("bookmark.resolution_3g", ""));
			setEnabled("bookmark.width_3g", custom);
			setEnabled("bookmark.height_3g", custom);
		}

		private void setEnabled(String key, boolean enabled)
		{
			Preference p = findPreference(key);
			if (p != null)
				p.setEnabled(enabled);
		}

		private void setIntSummaryProvider()
		{
			Preference resPref = findPreference("bookmark.resolution_3g");
			if (resPref != null)
			{
				resPref.setSummaryProvider(preference -> {
					SharedPreferences sp = getPreferenceManager().getSharedPreferences();
					String res = sp.getString("bookmark.resolution_3g", "800x600");
					if ("automatic".equals(res))
						return getString(R.string.resolution_automatic);
					if ("custom".equals(res))
						return getString(R.string.resolution_custom);
					if ("fitscreen".equals(res))
						return getString(R.string.resolution_fit);
					return res;
				});
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class PerformanceFragment3g extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.performance_flags_3g, rootKey);
			if (!LibFreeRDP.hasH264Support())
			{
				Preference p = findPreference(getString(R.string.preference_key_h264_3g));
				if (p != null)
					p.setEnabled(false);
			}
		}
	}

	// -------------------------------------------------------------------------

	public static class GatewayFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.gateway_settings, rootKey);
		}
	}

	// -------------------------------------------------------------------------

	public static class DebugFragment extends PreferenceFragmentCompat
	{
		@Override public void onCreatePreferences(Bundle savedInstanceState, String rootKey)
		{
			getPreferenceManager().setSharedPreferencesName(PREFS_NAME);
			getPreferenceManager().setSharedPreferencesMode(MODE_PRIVATE);
			setPreferencesFromResource(R.xml.debug_settings, rootKey);
		}
	}
}
