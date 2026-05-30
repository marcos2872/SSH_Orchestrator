/*
   Quick connect history gateway

   Copyright 2013 Thincast Technologies GmbH, Author: Martin Fleisz

   This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
   If a copy of the MPL was not distributed with this file, You can obtain one at
   http://mozilla.org/MPL/2.0/.
*/

package com.freerdp.freerdpcore.services;

import com.freerdp.freerdpcore.data.HistoryDao;
import com.freerdp.freerdpcore.data.HistoryEntity;
import com.freerdp.freerdpcore.domain.BookmarkBase;

import java.util.ArrayList;
import java.util.List;

public class QuickConnectHistoryGateway
{
	private final HistoryDao dao;

	public QuickConnectHistoryGateway(HistoryDao dao)
	{
		this.dao = dao;
	}

	public ArrayList<BookmarkBase> findHistory(String filter)
	{
		String query = (filter != null && !filter.isEmpty()) ? ("%" + filter + "%") : "%";
		List<HistoryEntity> entities = dao.findHistory(query);

		ArrayList<BookmarkBase> result = new ArrayList<>(entities.size());
		for (HistoryEntity entity : entities)
		{
			BookmarkBase bookmark = new BookmarkBase();
			bookmark.setType(BookmarkBase.TYPE_QUICKCONNECT);
			bookmark.setLabel(entity.item);
			bookmark.setHostname(entity.item);
			result.add(bookmark);
		}
		return result;
	}

	public void addHistoryItem(String item)
	{
		dao.insertOrReplace(new HistoryEntity(item));
	}

	public boolean historyItemExists(String item)
	{
		return dao.exists(item) > 0;
	}

	public void removeHistoryItem(String hostname)
	{
		dao.deleteByItem(hostname);
	}
}
